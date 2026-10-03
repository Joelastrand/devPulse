import { describe, expect, it, vi } from "vitest";
import { isMemberRef } from "../domain/member-ref";
import {
  materializeMemberRefs,
  type MaterializeMemberRefsCollection,
  type MaterializeMemberRefsDeps,
} from "./materialize-member-refs";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const ADMIN_EMAIL = "admin@example.com";
const EARLIER = new Date("2026-01-01T00:00:00Z");
const VALID_REF = "0123456789abcdefghjkmnpqrs";
const OTHER_VALID_REF = "zzzzzzzzzzzzzzzzzzzzzzzzzz";

function verifyTokenFor(email: string, uid = "admin-1") {
  return vi.fn().mockResolvedValue({ uid, email, email_verified: true });
}

const asAdmin = { verifyToken: verifyTokenFor(ADMIN_EMAIL), allowList: [ADMIN_EMAIL] };

type Doc = Record<string, unknown>;

function member(uid: string, extra: Doc = {}, teamId = "team-1"): [string, Doc] {
  return [
    `${uid}__${teamId}`,
    { uid, teamId, createdAt: EARLIER, createdVia: "invitation", grantedBy: "admin-0", ...extra },
  ];
}

/**
 * In-memory stand-in for one Firestore transaction. Like Firestore: reads see
 * committed state, queued writes apply only if `work` succeeds, an `update` on
 * a missing document fails the whole commit (nothing applied), and a listing
 * honours the requested limit.
 */
function fakeCollection(seed: {
  memberships: Array<[string, Doc]>;
  teams?: Record<string, unknown>;
  beforeCommit?: (memberships: Map<string, Doc>) => void;
  failCommit?: boolean;
}) {
  const memberships = new Map<string, Doc>(seed.memberships);
  const teams = seed.teams ?? { "team-1": "active" };
  const log = { runs: 0, writes: [] as Array<{ id: string; memberRef: string }> };

  const collection: MaterializeMemberRefsCollection = {
    async run(teamId, work) {
      log.runs += 1;
      const pending: Array<{ id: string; memberRef: string }> = [];
      const result = await work({
        async getTeamStatus() {
          return teams[teamId];
        },
        async listMemberships(limit) {
          return [...memberships.entries()]
            .filter(([, data]) => data.teamId === teamId)
            .slice(0, limit)
            .map(([id, data]) => ({ id, data: { ...data } }));
        },
        setMemberRef(id, memberRef) {
          pending.push({ id, memberRef });
        },
      });
      seed.beforeCommit?.(memberships);
      if (seed.failCommit || pending.some(({ id }) => !memberships.has(id))) {
        throw new Error("commit failed");
      }
      for (const write of pending) {
        memberships.set(write.id, { ...memberships.get(write.id), memberRef: write.memberRef });
        log.writes.push(write);
      }
      return result;
    },
  };

  return { collection, memberships, log };
}

function run(
  fake: { collection: MaterializeMemberRefsCollection },
  deps: MaterializeMemberRefsDeps = {},
  teamId = "team-1",
) {
  return materializeMemberRefs("token", teamId, { ...asAdmin, collection: fake.collection, ...deps });
}

describe("materializeMemberRefs — authorization", () => {
  it("rejects an unauthenticated caller with no transaction", async () => {
    const fake = fakeCollection({ memberships: [member("u1")] });
    const result = await materializeMemberRefs("", "team-1", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad")),
      allowList: [ADMIN_EMAIL],
      collection: fake.collection,
    });
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(fake.log.runs).toBe(0);
  });

  it("rejects a non-admin caller (even a team lead) with no transaction", async () => {
    const fake = fakeCollection({ memberships: [member("lead-1", { role: "lead" })] });
    const result = await run(fake, { verifyToken: verifyTokenFor("lead@example.com", "lead-1") });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(fake.log.runs).toBe(0);
    expect(fake.memberships.get("lead-1__team-1")?.memberRef).toBeUndefined();
  });
});

describe("materializeMemberRefs — preparation", () => {
  it("gives legacy memberships valid, distinct refs and preserves everything else", async () => {
    const fake = fakeCollection({
      memberships: [
        member("u1", { role: "lead", roleUpdatedBy: "admin-0", roleUpdatedAt: EARLIER }),
        member("u2"),
      ],
    });
    const before = new Map([...fake.memberships].map(([id, doc]) => [id, { ...doc }]));

    const result = await run(fake);

    expect(result).toEqual({ ok: true, materialized: 2, alreadyHad: 0, truncated: false });
    const refs = [...fake.memberships.values()].map((doc) => doc.memberRef);
    expect(refs.every(isMemberRef)).toBe(true);
    expect(new Set(refs).size).toBe(2);
    for (const [id, doc] of fake.memberships) {
      const rest = { ...doc };
      delete rest.memberRef;
      expect(rest).toEqual(before.get(id));
    }
    expect(fake.memberships.get("u1__team-1")?.role).toBe("lead");
    expect(fake.memberships.get("u2__team-1")).not.toHaveProperty("role");
  });

  it("preserves valid refs exactly and prepares only the missing ones", async () => {
    const fake = fakeCollection({
      memberships: [member("u1", { memberRef: VALID_REF }), member("u2")],
    });

    const result = await run(fake);

    expect(result).toEqual({ ok: true, materialized: 1, alreadyHad: 1, truncated: false });
    expect(fake.memberships.get("u1__team-1")?.memberRef).toBe(VALID_REF);
    expect(isMemberRef(fake.memberships.get("u2__team-1")?.memberRef)).toBe(true);
    expect(fake.log.writes.map((write) => write.id)).toEqual(["u2__team-1"]);
  });

  it.each([
    ["too short", "abc"],
    ["wrong alphabet", "ilou".repeat(7).slice(0, 26)],
    ["not a string", 42],
  ])("treats a malformed ref (%s) as missing and replaces it", async (_label, bad) => {
    const fake = fakeCollection({ memberships: [member("u1", { memberRef: bad })] });
    const result = await run(fake);
    expect(result).toMatchObject({ ok: true, materialized: 1, alreadyHad: 0 });
    expect(isMemberRef(fake.memberships.get("u1__team-1")?.memberRef)).toBe(true);
  });

  it("is idempotent: a second run writes nothing and rotates nothing", async () => {
    const fake = fakeCollection({ memberships: [member("u1"), member("u2")] });
    await run(fake);
    const afterFirst = new Map([...fake.memberships].map(([id, doc]) => [id, { ...doc }]));
    const writesAfterFirst = fake.log.writes.length;

    const second = await run(fake);

    expect(second).toEqual({ ok: true, materialized: 0, alreadyHad: 2, truncated: false });
    expect(fake.log.writes.length).toBe(writesAfterFirst);
    expect(fake.memberships).toEqual(afterFirst);
  });

  it("handles a team whose memberships are all already prepared", async () => {
    const fake = fakeCollection({ memberships: [member("u1", { memberRef: VALID_REF })] });
    expect(await run(fake)).toEqual({ ok: true, materialized: 0, alreadyHad: 1, truncated: false });
    expect(fake.log.writes).toEqual([]);
  });

  it("regenerates a new ref that collides with one already held in the team", async () => {
    const fake = fakeCollection({
      memberships: [member("u1", { memberRef: VALID_REF }), member("u2")],
    });
    const generateRef = vi.fn().mockReturnValueOnce(VALID_REF).mockReturnValueOnce(OTHER_VALID_REF);

    const result = await run(fake, { generateRef });

    expect(result).toMatchObject({ ok: true, materialized: 1 });
    expect(fake.memberships.get("u2__team-1")?.memberRef).toBe(OTHER_VALID_REF);
    expect(generateRef).toHaveBeenCalledTimes(2);
  });

  it("prepares 120 legacy memberships in a single transaction", async () => {
    const fake = fakeCollection({ memberships: Array.from({ length: 120 }, (_, i) => member(`u${i}`)) });

    const result = await run(fake);

    expect(result).toEqual({ ok: true, materialized: 120, alreadyHad: 0, truncated: false });
    expect(fake.log.runs).toBe(1);
    expect(new Set([...fake.memberships.values()].map((doc) => doc.memberRef)).size).toBe(120);
  });

  it("only touches the route team's memberships", async () => {
    const fake = fakeCollection({ memberships: [member("u1"), member("u1", {}, "team-2")] });
    await run(fake);
    expect(fake.memberships.get("u1__team-1")?.memberRef).toBeDefined();
    expect(fake.memberships.get("u1__team-2")?.memberRef).toBeUndefined();
  });

  it("ignores documents that are not genuine memberships of the team", async () => {
    const fake = fakeCollection({
      memberships: [member("u1"), ["wrong-id", { uid: "u2", teamId: "team-1" }], ["x__team-1", { teamId: "team-1" }]],
    });
    const result = await run(fake);
    expect(result).toEqual({ ok: true, materialized: 1, alreadyHad: 0, truncated: false });
    expect(fake.memberships.get("wrong-id")?.memberRef).toBeUndefined();
  });

  it("never creates memberships and returns no uid or ref", async () => {
    const fake = fakeCollection({ memberships: [member("u1")] });
    const result = await run(fake);
    expect(fake.memberships.size).toBe(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("u1");
    expect(serialized).not.toContain(String(fake.memberships.get("u1__team-1")?.memberRef));
  });
});

describe("materializeMemberRefs — team status", () => {
  it("prepares a disabled team", async () => {
    const fake = fakeCollection({ memberships: [member("u1")], teams: { "team-1": "disabled" } });
    expect(await run(fake)).toMatchObject({ ok: true, materialized: 1 });
  });

  it.each([
    ["missing team", {}],
    ["invalid status", { "team-1": "archived" }],
  ])("returns team_not_found for %s with no writes", async (_label, teams) => {
    const fake = fakeCollection({ memberships: [member("u1")], teams });
    expect(await run(fake)).toEqual({ ok: false, error: "team_not_found" });
    expect(fake.log.writes).toEqual([]);
  });

  it.each(["", "a/b", "  "])("returns team_not_found for invalid team id %j without a transaction", async (id) => {
    const fake = fakeCollection({ memberships: [member("u1")] });
    expect(await run(fake, {}, id)).toEqual({ ok: false, error: "team_not_found" });
    expect(fake.log.runs).toBe(0);
  });
});

describe("materializeMemberRefs — bound", () => {
  it("processes at most 500 and reports truncated when there are more", async () => {
    const fake = fakeCollection({ memberships: Array.from({ length: 501 }, (_, i) => member(`u${i}`)) });
    const result = await run(fake);
    expect(result).toEqual({ ok: true, materialized: 500, alreadyHad: 0, truncated: true });
    expect(fake.log.writes.length).toBe(500);
  });

  it("is not truncated at exactly 500", async () => {
    const fake = fakeCollection({ memberships: Array.from({ length: 500 }, (_, i) => member(`u${i}`)) });
    expect(await run(fake)).toEqual({ ok: true, materialized: 500, alreadyHad: 0, truncated: false });
  });
});

describe("materializeMemberRefs — atomicity", () => {
  it("never recreates a membership removed between read and commit, and writes nothing", async () => {
    const fake = fakeCollection({
      memberships: [member("u1"), member("u2")],
      beforeCommit: (memberships) => memberships.delete("u2__team-1"),
    });

    const result = await run(fake);

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(fake.memberships.has("u2__team-1")).toBe(false);
    expect(fake.memberships.get("u1__team-1")?.memberRef).toBeUndefined();
    expect(fake.log.writes).toEqual([]);
  });

  it("returns persistence_failed with no partial writes when the commit fails", async () => {
    const fake = fakeCollection({ memberships: [member("u1"), member("u2")], failCommit: true });
    expect(await run(fake)).toEqual({ ok: false, error: "persistence_failed" });
    expect(fake.log.writes).toEqual([]);
  });

  it("returns persistence_failed when the transaction itself fails", async () => {
    const collection: MaterializeMemberRefsCollection = {
      run: () => Promise.reject(new Error("unavailable")),
    };
    const result = await materializeMemberRefs("token", "team-1", { ...asAdmin, collection });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });
});

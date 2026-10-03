import { describe, expect, it, vi } from "vitest";
import type { AuthorizeTeamAccessCollection } from "./authorize-team-access";
import {
  ASSIGNABLE_MEMBERS_MAX,
  listAssignableMembers,
  type AssignableMembersStore,
  type ListAssignableMembersDeps,
} from "./list-assignable-members";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const ADMIN_EMAIL = "admin@example.com";
const T0 = new Date("2026-01-01T00:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const REF = (n: number) => `${String(n).padStart(2, "0")}bbbbbbbbbbbbbbbbbbbbbbbb`;

function tokenFor(uid: string, email = `${uid}@example.com`) {
  return vi.fn().mockResolvedValue({ uid, email, email_verified: true });
}

function member(uid: string, n: number, extra: Record<string, unknown> = {}) {
  return {
    uid,
    teamId: "team-1",
    createdAt: day(n),
    createdVia: "invitation",
    grantedBy: "admin-secret",
    memberRef: REF(n),
    ...extra,
  };
}

interface World {
  teams?: Record<string, unknown>;
  memberships?: Record<string, Record<string, unknown>>;
  rawDocs?: unknown[];
  profiles?: Record<string, unknown>;
  failAuthStatus?: boolean;
  failList?: boolean;
  failProfiles?: boolean;
}

function build(world: World, callerUid = "user-1") {
  const log = { listLimit: [] as number[], profileBatches: [] as string[][], teamIds: [] as string[] };

  const collection: AuthorizeTeamAccessCollection = {
    async getTeamStatus(teamId) {
      if (world.failAuthStatus) throw new Error("secret internal detail");
      return world.teams?.[teamId];
    },
    async getMembership(uid, teamId) {
      return world.memberships?.[`${uid}__${teamId}`];
    },
  };

  const store: AssignableMembersStore = {
    async listMemberships(teamId, limit) {
      log.listLimit.push(limit);
      log.teamIds.push(teamId);
      if (world.failList) throw new Error("secret internal detail");
      const docs =
        world.rawDocs ?? Object.values(world.memberships ?? {}).filter((doc) => doc.teamId === teamId);
      return docs.slice(0, limit);
    },
  };

  // Any other property access on these seams would be a write attempt; the
  // seams expose reads only, so a Proxy-free structural check is enough.
  const deps: ListAssignableMembersDeps = {
    verifyToken: tokenFor(callerUid),
    allowList: [ADMIN_EMAIL],
    collection,
    store,
    profileReader: {
      async readBatch(uids) {
        log.profileBatches.push([...uids]);
        if (world.failProfiles) throw new Error("secret internal detail");
        return uids.map((uid) => ({ uid, data: world.profiles?.[uid] }));
      },
    },
  };
  return { deps, log, store, collection };
}

const profile = (displayName: string) => ({ displayName, createdAt: T0, updatedAt: T0 });

function teamWorld(): World {
  return {
    teams: { "team-1": "active", "team-2": "active" },
    memberships: {
      "user-1__team-1": member("user-1", 1),
      "user-2__team-1": member("user-2", 2, { role: "lead", roleUpdatedAt: day(9), roleUpdatedBy: "admin-secret" }),
      "user-3__team-1": member("user-3", 3),
      "user-9__team-2": { ...member("user-9", 1), teamId: "team-2", memberRef: REF(90) },
    },
    profiles: {
      "user-1": profile("Anna Berg"),
      "user-2": profile("Cecilia Dahl"),
      "user-9": profile("Only In Team Two"),
    },
  };
}

async function ok(world: World, callerUid = "user-1") {
  const { deps, log } = build(world, callerUid);
  const result = await listAssignableMembers("token", "team-1", deps);
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return { result, log };
}

describe("listAssignableMembers — authorization", () => {
  it("returns the list to a genuine member", async () => {
    const { result } = await ok(teamWorld());

    expect(result.members.map((m) => m.displayName)).toEqual(["Anna Berg", "Cecilia Dahl", null]);
  });

  it("gives a team lead exactly the member view (no extra capability or field)", async () => {
    const { result } = await ok(teamWorld(), "user-2");

    expect(result.members.find((m) => m.isSelf)?.displayName).toBe("Cecilia Dahl");
    expect(JSON.stringify(result)).not.toMatch(/lead|role/i);
  });

  it("lets an app admin without membership read, but does not list them", async () => {
    const world = teamWorld();
    const { deps } = build(world, "admin-uid");
    const result = await listAssignableMembers("token", "team-1", {
      ...deps,
      verifyToken: tokenFor("admin-uid", ADMIN_EMAIL),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.members).toHaveLength(3);
      expect(result.members.every((m) => !m.isSelf)).toBe(true);
    }
  });

  it("rejects an invalid token as unauthenticated without touching storage", async () => {
    const { deps, log } = build(teamWorld());

    const result = await listAssignableMembers("token", "team-1", {
      ...deps,
      verifyToken: vi.fn().mockRejectedValue(new Error("bad")),
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(log.listLimit).toEqual([]);
    expect(log.profileBatches).toEqual([]);
  });

  it("denies a non-member with forbidden and reads nothing", async () => {
    const { deps, log } = build(teamWorld(), "stranger");

    const result = await listAssignableMembers("token", "team-1", deps);

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(log.listLimit).toEqual([]);
    expect(log.profileBatches).toEqual([]);
  });

  it("denies a member of another team (cross-team caller)", async () => {
    const { deps } = build(teamWorld(), "user-9");

    expect(await listAssignableMembers("token", "team-1", deps)).toEqual({ ok: false, error: "forbidden" });
  });

  it("still lets a member of a disabled team read", async () => {
    const world = teamWorld();
    world.teams = { "team-1": "disabled" };

    const { result } = await ok(world);

    expect(result.members).toHaveLength(3);
  });

  it("denies when the team does not exist or has an invalid status", async () => {
    const world = teamWorld();
    world.teams = { "team-1": "weird" };
    const { deps } = build(world);

    expect(await listAssignableMembers("token", "team-1", deps)).toEqual({ ok: false, error: "forbidden" });
  });

  it("reports read_failed (not forbidden) when authorization cannot be decided, without leaking detail", async () => {
    const world = teamWorld();
    world.failAuthStatus = true;
    const { deps } = build(world);

    const result = await listAssignableMembers("token", "team-1", deps);

    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reports read_failed on a membership read failure or profile failure, without leaking detail", async () => {
    for (const failure of [{ failList: true }, { failProfiles: true }]) {
      const { deps } = build({ ...teamWorld(), ...failure });

      const result = await listAssignableMembers("token", "team-1", deps);

      expect(result).toEqual({ ok: false, error: "read_failed" });
    }
  });

  it("reads only the requested team's memberships, with the bounded query", async () => {
    const { result, log } = await ok(teamWorld());

    expect(log.teamIds).toEqual(["team-1"]);
    expect(log.listLimit).toEqual([ASSIGNABLE_MEMBERS_MAX + 1]);
    expect(JSON.stringify(result)).not.toContain(REF(90));
    expect(JSON.stringify(result)).not.toContain("Only In Team Two");
    expect(log.profileBatches.flat()).not.toContain("user-9");
  });

  it("drops a membership document that claims another team even if the store returns it", async () => {
    const world = teamWorld();
    world.rawDocs = [
      member("user-1", 1),
      { ...member("user-9", 5), teamId: "team-2", memberRef: REF(95) },
    ];

    const { result } = await ok(world);

    expect(result.members.map((m) => m.memberRef)).toEqual([REF(1)]);
    expect(result.unavailableCount).toBe(0);
  });
});

describe("listAssignableMembers — eligibility and memberRef", () => {
  it("returns the stored valid memberRef as the opaque selection handle", async () => {
    const { result } = await ok(teamWorld());

    expect(result.members.map((m) => m.memberRef).sort()).toEqual([REF(1), REF(2), REF(3)]);
  });

  it("omits a legacy member without a ref, never fabricates one, and counts it", async () => {
    const world = teamWorld();
    const { memberRef: _omit, ...legacy } = member("user-3", 3);
    void _omit;
    world.memberships!["user-3__team-1"] = legacy;

    const { result } = await ok(world);

    expect(result.members).toHaveLength(2);
    expect(result.unavailableCount).toBe(1);
    expect(result.members.map((m) => m.memberRef).sort()).toEqual([REF(1), REF(2)]);
  });

  it("fails closed on a malformed memberRef: omitted and counted", async () => {
    const world = teamWorld();
    world.memberships!["user-3__team-1"] = member("user-3", 3, { memberRef: "NOT-A-REF" });
    world.memberships!["user-2__team-1"] = member("user-2", 2, { memberRef: 12345 });

    const { result } = await ok(world);

    expect(result.members.map((m) => m.memberRef)).toEqual([REF(1)]);
    expect(result.unavailableCount).toBe(2);
  });

  it("excludes every member sharing a duplicate valid ref (never two ambiguous selectable members)", async () => {
    const world = teamWorld();
    world.memberships!["user-3__team-1"] = member("user-3", 3, { memberRef: REF(2) });

    const { result } = await ok(world);

    expect(result.members.map((m) => m.memberRef)).toEqual([REF(1)]);
    expect(result.unavailableCount).toBe(2);
    const refs = result.members.map((m) => m.memberRef);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("does not treat the same ref string in another team as a duplicate", async () => {
    const world = teamWorld();
    world.memberships!["user-9__team-2"] = { ...member("user-9", 1), teamId: "team-2", memberRef: REF(1) };

    const { result } = await ok(world);

    expect(result.members.map((m) => m.memberRef).sort()).toEqual([REF(1), REF(2), REF(3)]);
    expect(result.unavailableCount).toBe(0);
  });

  it("skips malformed documents (no uid / non-object) without counting them", async () => {
    const world = teamWorld();
    world.rawDocs = [member("user-1", 1), { teamId: "team-1", memberRef: REF(7) }, null, "junk", member("", 4)];

    const { result } = await ok(world);

    expect(result.members.map((m) => m.memberRef)).toEqual([REF(1)]);
    expect(result.unavailableCount).toBe(0);
  });

  it("omits a removed member on the next call", async () => {
    const world = teamWorld();
    expect((await ok(world)).result.members).toHaveLength(3);
    delete world.memberships!["user-3__team-1"];

    expect((await ok(world)).result.members).toHaveLength(2);
  });

  it("truncates at 500 and reports it", async () => {
    const world = teamWorld();
    world.rawDocs = Array.from({ length: ASSIGNABLE_MEMBERS_MAX + 1 }, (_, i) =>
      member(`u-${i}`, i, { memberRef: `${String(i).padStart(3, "0")}cccccccccccccccccccccc3`.slice(0, 26) }),
    );
    world.memberships = { "user-1__team-1": member("user-1", 1) };

    const { result } = await ok(world);

    expect(result.truncated).toBe(true);
    expect(result.members).toHaveLength(ASSIGNABLE_MEMBERS_MAX);
  });

  it("is not truncated at exactly 500", async () => {
    const world = teamWorld();
    world.rawDocs = Array.from({ length: ASSIGNABLE_MEMBERS_MAX }, (_, i) =>
      member(`u-${i}`, i, { memberRef: `${String(i).padStart(3, "0")}cccccccccccccccccccccc3`.slice(0, 26) }),
    );
    world.memberships = { "user-1__team-1": member("user-1", 1) };

    expect((await ok(world)).result.truncated).toBe(false);
  });
});

describe("listAssignableMembers — names and ordinals", () => {
  it("uses profile display names, null for missing and corrupt profiles, never e-mail/uid", async () => {
    const world = teamWorld();
    world.profiles!["user-3"] = { displayName: 42 };

    const { result } = await ok(world);

    expect(result.members.map((m) => m.displayName)).toEqual(["Anna Berg", "Cecilia Dahl", null]);
    const text = JSON.stringify(result);
    expect(text).not.toContain("user-3");
    expect(text).not.toContain("@example.com");
  });

  it("gives unique names no ordinal", async () => {
    const { result } = await ok(teamWorld());

    expect(result.members.map((m) => m.ordinal)).toEqual([null, null, null]);
  });

  it("numbers duplicate names by createdAt, then memberRef, and multiple unnamed members too", async () => {
    const world = teamWorld();
    world.profiles = {
      "user-1": profile("Alex"),
      "user-2": profile("alex"),
      // user-3 and user-4 unnamed
    };
    world.memberships!["user-4__team-1"] = member("user-4", 3, { memberRef: REF(4) }); // same createdAt as user-3, higher ref

    const { result } = await ok(world);

    expect(result.members.map((m) => [m.memberRef, m.displayName, m.ordinal])).toEqual([
      [REF(1), "Alex", 1],
      [REF(2), "alex", 2],
      [REF(3), null, 1],
      [REF(4), null, 2],
    ]);
  });

  it("marks isSelf from the verified caller only", async () => {
    const { result } = await ok(teamWorld(), "user-3");

    expect(result.members.filter((m) => m.isSelf).map((m) => m.memberRef)).toEqual([REF(3)]);
  });
});

describe("listAssignableMembers — privacy and read-only", () => {
  it("returns exact keys and no identity, timing, role or audit data", async () => {
    const { result } = await ok(teamWorld());

    expect(Object.keys(result).sort()).toEqual(["members", "ok", "truncated", "unavailableCount"]);
    for (const entry of result.members) {
      expect(Object.keys(entry).sort()).toEqual(["displayName", "isSelf", "memberRef", "ordinal"]);
    }
    const text = JSON.stringify(result);
    for (const forbidden of [
      "user-1", "user-2", "user-3", "@example.com", "admin-secret", "__team-1",
      "createdAt", "createdVia", "grantedBy", "role", "hasMemberRef", "authorTag", "uid", "email",
      "2026-01", String(day(1).getTime()),
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("makes no write: the seams offer only reads and the stored documents are unchanged", async () => {
    const world = teamWorld();
    const { memberRef: _omit, ...legacy } = member("user-3", 3);
    void _omit;
    world.memberships!["user-3__team-1"] = legacy;
    const before = structuredClone(world.memberships);
    const { deps, store, collection } = build(world);

    await listAssignableMembers("token", "team-1", deps);

    expect(Object.keys(store)).toEqual(["listMemberships"]);
    expect(Object.keys(collection).sort()).toEqual(["getMembership", "getTeamStatus"]);
    expect(world.memberships).toEqual(before);
    expect(world.memberships!["user-3__team-1"]).not.toHaveProperty("memberRef");
  });
});

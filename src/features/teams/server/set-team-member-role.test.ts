import { describe, expect, it, vi } from "vitest";
import { REMOVE_FIELD, setTeamMemberRole, type SetTeamMemberRoleCollection } from "./set-team-member-role";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-10-01T00:00:00Z");
const EARLIER = new Date("2026-01-01T00:00:00Z");

function verifyTokenFor(email: string, uid = "admin-1") {
  return vi.fn().mockResolvedValue({ uid, email, email_verified: true });
}

const asAdmin = { verifyToken: verifyTokenFor(ADMIN_EMAIL), allowList: [ADMIN_EMAIL], now: NOW };

type Doc = Record<string, unknown>;

/**
 * In-memory stand-in for one Firestore transaction over the membership and
 * team documents. Like Firestore: reads see committed state, writes are
 * applied only when `work` completes successfully, and `update` on a
 * missing document fails rather than creating it.
 */
function fakeCollection(seed: { memberships?: Record<string, Doc>; teams?: Record<string, unknown> }) {
  const memberships = new Map<string, Doc>(Object.entries(seed.memberships ?? {}));
  const teams = new Map<string, unknown>(Object.entries(seed.teams ?? {}));
  const log = { runs: 0, teamStatusReads: 0, membershipReads: 0, updates: [] as Array<Record<string, unknown>> };

  const collection: SetTeamMemberRoleCollection = {
    async run(uid, teamId, work) {
      log.runs += 1;
      const key = `${uid}__${teamId}`;
      let pending: Record<string, unknown> | undefined;
      const result = await work({
        async getMembership() {
          log.membershipReads += 1;
          return memberships.get(key);
        },
        async getTeamStatus() {
          log.teamStatusReads += 1;
          return teams.get(teamId);
        },
        update(fields) {
          pending = fields;
        },
      });
      if (pending) {
        const existing = memberships.get(key);
        if (!existing) {
          throw new Error("NOT_FOUND: update() cannot create a document");
        }
        log.updates.push(pending);
        const next = { ...existing };
        for (const [field, value] of Object.entries(pending)) {
          if (value === REMOVE_FIELD) {
            delete next[field];
          } else {
            next[field] = value;
          }
        }
        memberships.set(key, next);
      }
      return result;
    },
  };

  return { collection, memberships, log };
}

const plainMember = { uid: "user-1", teamId: "team-1", createdAt: EARLIER, createdVia: "invitation", grantedBy: "admin-0" };

describe("setTeamMemberRole — promotion", () => {
  it("makes a member of an active team a lead, recording the acting admin and time", async () => {
    const { collection, memberships } = fakeCollection({
      memberships: { "user-1__team-1": plainMember },
      teams: { "team-1": "active" },
    });

    const result = await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });

    expect(result).toEqual({ ok: true, role: "lead" });
    expect(memberships.get("user-1__team-1")).toEqual({
      ...plainMember,
      role: "lead",
      roleUpdatedAt: NOW,
      roleUpdatedBy: "admin-1",
    });
  });

  it("allows several leads in one team without demoting anyone else", async () => {
    const { collection, memberships } = fakeCollection({
      memberships: {
        "user-1__team-1": plainMember,
        "user-2__team-1": { ...plainMember, uid: "user-2" },
        "user-3__team-1": { ...plainMember, uid: "user-3" },
      },
      teams: { "team-1": "active" },
    });

    await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });
    await setTeamMemberRole("token", "team-1", "user-2", "lead", { ...asAdmin, collection });

    expect(memberships.get("user-1__team-1")?.role).toBe("lead");
    expect(memberships.get("user-2__team-1")?.role).toBe("lead");
    expect(memberships.get("user-3__team-1")).not.toHaveProperty("role");
  });

  it("is idempotent for an existing lead on an active team", async () => {
    const { collection, memberships } = fakeCollection({
      memberships: { "user-1__team-1": { ...plainMember, role: "lead" } },
      teams: { "team-1": "active" },
    });

    const first = await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });
    const second = await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });

    expect(first).toEqual({ ok: true, role: "lead" });
    expect(second).toEqual({ ok: true, role: "lead" });
    expect(memberships.get("user-1__team-1")?.role).toBe("lead");
  });

  it.each([
    ["disabled", "disabled"],
    ["missing", undefined],
    ["malformed (unknown string)", "archived"],
    ["malformed (wrong type)", 1],
    ["malformed (wrong case)", "Active"],
  ])("rejects promotion on a team whose status is %s and performs no write", async (_label, status) => {
    const { collection, memberships, log } = fakeCollection({
      memberships: { "user-1__team-1": plainMember },
      teams: { "team-1": status },
    });

    const result = await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(log.updates).toEqual([]);
    expect(memberships.get("user-1__team-1")).toEqual(plainMember);
  });

  it("rejects re-assigning lead to an existing lead on a disabled team and leaves the membership untouched", async () => {
    const lead = { ...plainMember, role: "lead", roleUpdatedAt: EARLIER, roleUpdatedBy: "admin-0" };
    const { collection, memberships, log } = fakeCollection({
      memberships: { "user-1__team-1": lead },
      teams: { "team-1": "disabled" },
    });

    const result = await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(log.updates).toEqual([]);
    expect(memberships.get("user-1__team-1")).toEqual(lead);
  });

  it("reports a missing team with no membership as not_a_member and creates nothing", async () => {
    const { collection, memberships, log } = fakeCollection({});

    const result = await setTeamMemberRole("token", "team-404", "user-1", "lead", { ...asAdmin, collection });

    expect(result).toEqual({ ok: false, error: "not_a_member" });
    expect(memberships.size).toBe(0);
    expect(log.updates).toEqual([]);
  });

  it("rejects a target that is not a member of that team and creates no membership", async () => {
    const { collection, memberships, log } = fakeCollection({
      memberships: { "user-1__team-2": { ...plainMember, teamId: "team-2" } },
      teams: { "team-1": "active", "team-2": "active" },
    });

    const result = await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });

    expect(result).toEqual({ ok: false, error: "not_a_member" });
    expect(memberships.has("user-1__team-1")).toBe(false);
    expect(memberships.get("user-1__team-2")).not.toHaveProperty("role");
    expect(log.updates).toEqual([]);
  });

  it("rejects a membership document that belongs to a different uid/team than the key claims", async () => {
    const { collection, log } = fakeCollection({
      memberships: { "user-1__team-1": { ...plainMember, uid: "someone-else" } },
      teams: { "team-1": "active" },
    });

    const result = await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });

    expect(result).toEqual({ ok: false, error: "not_a_member" });
    expect(log.updates).toEqual([]);
  });
});

describe("setTeamMemberRole — demotion", () => {
  it("returns a lead to an ordinary member by removing the role field, keeping the membership", async () => {
    const { collection, memberships } = fakeCollection({
      memberships: { "user-1__team-1": { ...plainMember, role: "lead" } },
      teams: { "team-1": "active" },
    });

    const result = await setTeamMemberRole("token", "team-1", "user-1", "member", { ...asAdmin, collection });

    expect(result).toEqual({ ok: true, role: "member" });
    const after = memberships.get("user-1__team-1");
    expect(after).not.toHaveProperty("role");
    expect(after).toEqual({ ...plainMember, roleUpdatedAt: NOW, roleUpdatedBy: "admin-1" });
  });

  it("is allowed on a disabled team and does not even read the team status", async () => {
    const { collection, memberships, log } = fakeCollection({
      memberships: { "user-1__team-1": { ...plainMember, role: "lead" } },
      teams: { "team-1": "disabled" },
    });

    const result = await setTeamMemberRole("token", "team-1", "user-1", "member", { ...asAdmin, collection });

    expect(result).toEqual({ ok: true, role: "member" });
    expect(memberships.get("user-1__team-1")).not.toHaveProperty("role");
    expect(log.teamStatusReads).toBe(0);
  });

  it("is idempotent for an ordinary member", async () => {
    const { collection, memberships } = fakeCollection({
      memberships: { "user-1__team-1": plainMember },
      teams: { "team-1": "active" },
    });

    const result = await setTeamMemberRole("token", "team-1", "user-1", "member", { ...asAdmin, collection });

    expect(result).toEqual({ ok: true, role: "member" });
    expect(memberships.get("user-1__team-1")).not.toHaveProperty("role");
  });

  it("does not create a membership when demoting a non-member", async () => {
    const { collection, memberships } = fakeCollection({ teams: { "team-1": "active" } });

    const result = await setTeamMemberRole("token", "team-1", "user-1", "member", { ...asAdmin, collection });

    expect(result).toEqual({ ok: false, error: "not_a_member" });
    expect(memberships.size).toBe(0);
  });
});

describe("setTeamMemberRole — transaction and sanitisation", () => {
  it("performs the membership read, the team-status read and the write inside exactly one transaction", async () => {
    const { collection, log } = fakeCollection({
      memberships: { "user-1__team-1": plainMember },
      teams: { "team-1": "active" },
    });

    await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });

    expect(log.runs).toBe(1);
    expect(log.membershipReads).toBe(1);
    expect(log.teamStatusReads).toBe(1);
    expect(log.updates).toHaveLength(1);
  });

  it("never reads team status or writes once the membership check fails", async () => {
    const { collection, log } = fakeCollection({ teams: { "team-1": "active" } });

    await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });

    expect(log.teamStatusReads).toBe(0);
    expect(log.updates).toEqual([]);
  });

  it("writes only role, roleUpdatedAt and roleUpdatedBy — no other field", async () => {
    const { collection, log } = fakeCollection({
      memberships: { "user-1__team-1": plainMember },
      teams: { "team-1": "active" },
    });

    await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });

    expect(Object.keys(log.updates[0]).sort()).toEqual(["role", "roleUpdatedAt", "roleUpdatedBy"]);
  });

  it("reports persistence_failed without echoing the underlying error", async () => {
    const collection: SetTeamMemberRoleCollection = {
      run: vi.fn().mockRejectedValue(new Error("secret internal detail")),
    };

    const result = await setTeamMemberRole("token", "team-1", "user-1", "lead", { ...asAdmin, collection });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("setTeamMemberRole — authorization and input", () => {
  it("rejects an authenticated non-admin without opening a transaction", async () => {
    const collection = { run: vi.fn() };

    const result = await setTeamMemberRole("token", "team-1", "user-1", "lead", {
      verifyToken: verifyTokenFor("dev@example.com", "dev-1"),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.run).not.toHaveBeenCalled();
  });

  it("rejects an allow-listed but unverified-email caller as forbidden", async () => {
    const collection = { run: vi.fn() };

    const result = await setTeamMemberRole("token", "team-1", "user-1", "lead", {
      verifyToken: vi.fn().mockResolvedValue({ uid: "admin-1", email: ADMIN_EMAIL, email_verified: false }),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.run).not.toHaveBeenCalled();
  });

  it("rejects an invalid token as unauthenticated", async () => {
    const collection = { run: vi.fn() };

    const result = await setTeamMemberRole("token", "team-1", "user-1", "lead", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(collection.run).not.toHaveBeenCalled();
  });

  it("checks authorization before input validation", async () => {
    const collection = { run: vi.fn() };

    const result = await setTeamMemberRole("token", "team-1", "user-1", "garbage", {
      verifyToken: verifyTokenFor("dev@example.com", "dev-1"),
      allowList: [ADMIN_EMAIL],
      collection,
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it.each([
    ["an unknown role string", "admin"],
    ["a differently-cased role", "Lead"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 1],
    ["an object", { role: "lead" }],
  ])("rejects %s as invalid_input without opening a transaction", async (_label, role) => {
    const collection = { run: vi.fn() };

    const result = await setTeamMemberRole("token", "team-1", "user-1", role, { ...asAdmin, collection });

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(collection.run).not.toHaveBeenCalled();
  });

  it.each([
    ["blank teamId", "  ", "user-1"],
    ["blank uid", "team-1", ""],
    ["a uid containing a slash", "team-1", "a/b"],
    ["a teamId containing a slash", "a/b", "user-1"],
  ])("rejects %s as invalid_input", async (_label, teamId, uid) => {
    const collection = { run: vi.fn() };

    const result = await setTeamMemberRole("token", teamId, uid, "lead", { ...asAdmin, collection });

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(collection.run).not.toHaveBeenCalled();
  });

  it("promotes an app admin who is also a member like anyone else (admin status of the target is irrelevant)", async () => {
    const { collection, memberships } = fakeCollection({
      memberships: { "admin-2__team-1": { ...plainMember, uid: "admin-2" } },
      teams: { "team-1": "active" },
    });

    const result = await setTeamMemberRole("token", "team-1", "admin-2", "lead", { ...asAdmin, collection });

    expect(result).toEqual({ ok: true, role: "lead" });
    expect(memberships.get("admin-2__team-1")?.role).toBe("lead");
  });
});

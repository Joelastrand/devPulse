import { FieldValue } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Doc = Record<string, unknown>;

/**
 * Minimal in-memory Firestore (documents, equality queries, transactions
 * with reads-before-writes semantics and a failing `update` on a missing
 * document). It lets the *production* default collections of the existing
 * grant/remove/authorize code run unchanged, so this file verifies that
 * adding the optional team `role` field changed none of their behaviour
 * (docs/features/member-identity-and-team-roles/SPEC.md — BR-21, BR-26,
 * BR-34). No real Firebase is contacted.
 */
const store = new Map<string, Doc>();

function key(collection: string, id: string): string {
  return `${collection}/${id}`;
}

function snapshot(path: string) {
  const data = store.get(path);
  return { exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }) };
}

function docRef(collection: string, id: string) {
  const path = key(collection, id);
  return {
    path,
    get: async () => snapshot(path),
    set: async (data: Doc) => void store.set(path, { ...data }),
    delete: async () => void store.delete(path),
    update: async (data: Doc) => applyUpdate(path, data),
  };
}

function applyUpdate(path: string, fields: Doc) {
  const existing = store.get(path);
  if (!existing) {
    throw new Error("NOT_FOUND");
  }
  const next = { ...existing };
  for (const [field, value] of Object.entries(fields)) {
    if (value instanceof FieldValue) {
      delete next[field];
    } else {
      next[field] = value;
    }
  }
  store.set(path, next);
}

function query(collection: string, filters: Array<[string, unknown]>, max = Infinity) {
  return {
    where(field: string, _op: string, value: unknown) {
      return query(collection, [...filters, [field, value]], max);
    },
    limit(count: number) {
      return query(collection, filters, count);
    },
    async get() {
      const docs = [...store.entries()]
        .filter(([path]) => path.startsWith(`${collection}/`))
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .slice(0, max)
        .map(([, data]) => ({ data: () => ({ ...data }) }));
      return { docs };
    },
  };
}

const fakeDb = {
  collection(name: string) {
    return {
      doc: (id: string) => docRef(name, id),
      where: (field: string, op: string, value: unknown) => query(name, []).where(field, op, value),
    };
  },
  async getAll(...refs: Array<{ path: string }>) {
    return refs.map((ref) => ({ id: ref.path.split("/")[1], ...snapshot(ref.path) }));
  },
  async runTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    const writes: Array<() => void> = [];
    const tx = {
      get: async (ref: { path: string }) => snapshot(ref.path),
      set: (ref: { path: string }, data: Doc) => void writes.push(() => void store.set(ref.path, { ...data })),
      update: (ref: { path: string }, data: Doc) => void writes.push(() => applyUpdate(ref.path, data)),
    };
    const result = await work(tx);
    writes.forEach((write) => write());
    return result;
  },
};

vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => fakeDb,
  getAdminAuth: () => ({}),
}));

const { setTeamMemberRole } = await import("./set-team-member-role");
const { approveAccessRequest } = await import("./approve-access-request");
const { grantTeamMembership } = await import("./grant-team-membership");
const { resolveInvitations } = await import("./resolve-invitations");
const { removeTeamMember } = await import("./remove-team-member");
const { authorizeTeamAccess } = await import("./authorize-team-access");
const { resolveTeamRole } = await import("./resolve-team-role");
const { listTeamRoster } = await import("./list-team-roster");

const ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-10-01T00:00:00Z");
const adminDeps = {
  verifyToken: vi.fn().mockResolvedValue({ uid: "admin-1", email: ADMIN_EMAIL, email_verified: true }),
  allowList: [ADMIN_EMAIL],
  now: NOW,
};

const GRANT_FIELDS = ["createdAt", "createdVia", "grantedBy", "teamId", "uid"];

function membership(uid: string, extra: Doc = {}): Doc {
  return { uid, teamId: "team-1", createdAt: NOW, createdVia: "admin_direct", grantedBy: "admin-0", ...extra };
}

beforeEach(() => {
  store.clear();
  store.set("teams/team-1", { name: "Team One", status: "active" });
});

describe("setTeamMemberRole against the production transaction adapter", () => {
  it("promotes, then demotes by deleting the role field while keeping the membership", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1"));

    await setTeamMemberRole("t", "team-1", "user-1", "lead", adminDeps);
    expect(store.get("teamMemberships/user-1__team-1")).toMatchObject({
      role: "lead",
      roleUpdatedBy: "admin-1",
      roleUpdatedAt: NOW,
    });

    await setTeamMemberRole("t", "team-1", "user-1", "member", adminDeps);
    const demoted = store.get("teamMemberships/user-1__team-1");
    expect(demoted).not.toHaveProperty("role");
    expect(demoted).toMatchObject({ uid: "user-1", teamId: "team-1", grantedBy: "admin-0" });
  });

  it("refuses promotion on a disabled team, writing nothing, but still allows demotion there", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1", { role: "lead" }));
    store.set("teams/team-1", { name: "Team One", status: "disabled" });

    const promote = await setTeamMemberRole("t", "team-1", "user-1", "lead", adminDeps);
    expect(promote).toEqual({ ok: false, error: "team_disabled" });
    expect(store.get("teamMemberships/user-1__team-1")?.role).toBe("lead");
    expect(store.get("teamMemberships/user-1__team-1")).not.toHaveProperty("roleUpdatedAt");

    const demote = await setTeamMemberRole("t", "team-1", "user-1", "member", adminDeps);
    expect(demote).toEqual({ ok: true, role: "member" });
    expect(store.get("teamMemberships/user-1__team-1")).not.toHaveProperty("role");
  });

  it("never creates a membership document for a non-member", async () => {
    const result = await setTeamMemberRole("t", "team-1", "stranger", "lead", adminDeps);

    expect(result).toEqual({ ok: false, error: "not_a_member" });
    expect([...store.keys()].filter((path) => path.startsWith("teamMemberships/"))).toEqual([]);
  });

  it("does not touch any other member's document when one lead is set", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1", { role: "lead" }));
    store.set("teamMemberships/user-2__team-1", membership("user-2"));

    await setTeamMemberRole("t", "team-1", "user-2", "lead", adminDeps);

    expect(store.get("teamMemberships/user-1__team-1")).toEqual(membership("user-1", { role: "lead" }));
    expect(store.get("teamMemberships/user-2__team-1")?.role).toBe("lead");
  });
});

describe("existing membership grant paths never write or inherit a role", () => {
  it("grantTeamMembership (used by createInvitation's immediate grant) creates a plain member", async () => {
    await grantTeamMembership({ uid: "user-1", teamId: "team-1", createdAt: NOW, createdVia: "admin_direct", grantedBy: "admin-1" });

    const created = store.get("teamMemberships/user-1__team-1");
    expect(Object.keys(created ?? {}).sort()).toEqual(GRANT_FIELDS);
  });

  it("approveAccessRequest creates a plain member", async () => {
    store.set("teamAccessRequests/user-1__team-1", { uid: "user-1", teamId: "team-1", status: "pending", createdAt: NOW });

    const result = await approveAccessRequest("t", "user-1", "team-1", adminDeps);

    expect(result).toEqual({ ok: true, outcome: "approved" });
    expect(Object.keys(store.get("teamMemberships/user-1__team-1") ?? {}).sort()).toEqual(GRANT_FIELDS);
  });

  it("resolveInvitations creates a plain member", async () => {
    store.set("teamInvitations/team-1__anna@example.com", {
      teamId: "team-1",
      email: "anna@example.com",
      status: "pending",
      invitedBy: "admin-1",
      createdAt: NOW,
    });

    const result = await resolveInvitations(
      { uid: "user-1", email: "anna@example.com", emailVerified: true },
      { now: NOW },
    );

    expect(result).toEqual({ ok: true, membershipsCreated: 1 });
    expect(Object.keys(store.get("teamMemberships/user-1__team-1") ?? {}).sort()).toEqual(GRANT_FIELDS);
  });

  it("a lead who is removed and later re-granted comes back as an ordinary member", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1", { role: "lead", roleUpdatedAt: NOW, roleUpdatedBy: "admin-1" }));

    const removed = await removeTeamMember("t", "team-1", "user-1", adminDeps);
    expect(removed).toEqual({ ok: true });
    expect(store.has("teamMemberships/user-1__team-1")).toBe(false);

    await grantTeamMembership({ uid: "user-1", teamId: "team-1", createdAt: NOW, createdVia: "invitation", grantedBy: "admin-2" });

    const regranted = store.get("teamMemberships/user-1__team-1");
    expect(regranted).not.toHaveProperty("role");
    expect(regranted).not.toHaveProperty("roleUpdatedBy");
  });

  it("an existing lead is left exactly as it was by a later grant attempt (no overwrite, no demotion)", async () => {
    const lead = membership("user-1", { role: "lead", roleUpdatedAt: NOW, roleUpdatedBy: "admin-1" });
    store.set("teamMemberships/user-1__team-1", lead);

    const outcome = await grantTeamMembership({ uid: "user-1", teamId: "team-1", createdAt: NOW, createdVia: "invitation", grantedBy: "admin-2" });

    expect(outcome).toBe("already_member");
    expect(store.get("teamMemberships/user-1__team-1")).toEqual(lead);
  });
});

describe("authorizeTeamAccess is unaffected by the role field", () => {
  const nonAdmin = { uid: "user-1", email: "dev@example.com", emailVerified: true };
  const deps = { allowList: [ADMIN_EMAIL] };

  it.each([
    ["no role (every pre-existing membership)", {}],
    ["role: lead", { role: "lead" }],
    ["an unknown role value", { role: "superuser" }],
    ["a malformed role value", { role: 42 }],
  ])("a member with %s is exactly \"member\"", async (_label, extra) => {
    store.set("teamMemberships/user-1__team-1", membership("user-1", extra));

    expect(await authorizeTeamAccess(nonAdmin, "team-1", deps)).toEqual({ ok: true, access: "member" });
  });

  it("removing a lead's membership leaves them with no access at all on the very next check", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1", { role: "lead" }));
    expect(await authorizeTeamAccess(nonAdmin, "team-1", deps)).toEqual({ ok: true, access: "member" });

    await removeTeamMember("t", "team-1", "user-1", adminDeps);

    expect(await authorizeTeamAccess(nonAdmin, "team-1", deps)).toEqual({ ok: true, access: "denied" });
  });

  it("a lead on a disabled team is still just a member — no new rights are granted", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1", { role: "lead" }));
    store.set("teams/team-1", { name: "Team One", status: "disabled" });

    expect(await authorizeTeamAccess(nonAdmin, "team-1", deps)).toEqual({ ok: true, access: "member" });
  });
});

describe("resolveTeamRole against the production Firestore reads", () => {
  const nonAdmin = { uid: "user-1", email: "dev@example.com", emailVerified: true };
  const deps = { allowList: [ADMIN_EMAIL] };

  it("resolves lead, member and denied from real documents, while authorizeTeamAccess keeps reporting the lead as member", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1", { role: "lead" }));
    store.set("teamMemberships/user-2__team-1", membership("user-2"));

    expect(await resolveTeamRole(nonAdmin, "team-1", deps)).toEqual({ ok: true, role: "lead" });
    expect(await resolveTeamRole({ ...nonAdmin, uid: "user-2" }, "team-1", deps)).toEqual({ ok: true, role: "member" });
    expect(await resolveTeamRole({ ...nonAdmin, uid: "user-3" }, "team-1", deps)).toEqual({ ok: true, role: "denied" });
    expect(await authorizeTeamAccess(nonAdmin, "team-1", deps)).toEqual({ ok: true, access: "member" });
  });

  it("makes a stored lead dormant while the team is disabled and effective again after re-activation", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1", { role: "lead" }));

    store.set("teams/team-1", { name: "Team One", status: "disabled" });
    expect(await resolveTeamRole(nonAdmin, "team-1", deps)).toEqual({ ok: true, role: "member" });
    expect(store.get("teamMemberships/user-1__team-1")?.role).toBe("lead");

    store.set("teams/team-1", { name: "Team One", status: "active" });
    expect(await resolveTeamRole(nonAdmin, "team-1", deps)).toEqual({ ok: true, role: "lead" });
  });

  it("resolves an app admin to admin even when also a lead member", async () => {
    store.set("teamMemberships/admin-1__team-1", membership("admin-1", { role: "lead" }));

    const result = await resolveTeamRole({ uid: "admin-1", email: ADMIN_EMAIL, emailVerified: true }, "team-1", deps);

    expect(result).toEqual({ ok: true, role: "admin" });
  });
});

describe("listTeamRoster against the production Firestore reads", () => {
  const verifyToken = vi.fn().mockResolvedValue({ uid: "user-1", email: "dev@example.com", email_verified: true });
  const timestamp = (date: Date) => ({ toDate: () => date });

  it("builds the roster from real memberships and profile documents with no Auth lookup and no uid in the output", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1", { createdAt: timestamp(NOW) }));
    store.set("teamMemberships/user-2__team-1", membership("user-2", { role: "lead", roleUpdatedBy: "admin-secret" }));
    store.set("teamMemberships/user-3__team-2", { ...membership("user-3"), teamId: "team-2" });
    store.set("userProfiles/user-1", { displayName: "Anna Berg", createdAt: NOW, updatedAt: NOW });
    store.set("userProfiles/user-3", { displayName: "Other Team Person", createdAt: NOW, updatedAt: NOW });

    const result = await listTeamRoster("t", "team-1", { verifyToken });

    expect(result).toEqual({
      ok: true,
      truncated: false,
      members: [
        { displayName: null, isLead: true, isSelf: false },
        { displayName: "Anna Berg", isLead: false, isSelf: true },
      ],
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain("Other Team Person");
    expect(text).not.toContain("user-");
    expect(text).not.toContain("admin-secret");
  });

  it("denies a user whose membership was removed on the next call", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1"));
    expect((await listTeamRoster("t", "team-1", { verifyToken })).ok).toBe(true);

    await removeTeamMember("t", "team-1", "user-1", adminDeps);

    expect(await listTeamRoster("t", "team-1", { verifyToken })).toEqual({ ok: false, error: "forbidden" });
  });

  it("does not turn a dormant lead on a disabled team into an effective lead", async () => {
    store.set("teamMemberships/user-1__team-1", membership("user-1", { role: "lead" }));
    store.set("teams/team-1", { name: "Team One", status: "disabled" });

    const result = await listTeamRoster("t", "team-1", { verifyToken });

    expect(result).toEqual({ ok: true, truncated: false, members: [{ displayName: null, isLead: false, isSelf: true }] });
  });
});

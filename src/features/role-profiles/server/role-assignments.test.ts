import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";
import {
  assignRoleToUser,
  getOwnRoleAssignment,
  lookupRoleAssignments,
  removeRoleAssignment,
  type RoleAssignmentDeps,
} from "./role-assignments";
import { createFakeRoleStore } from "./fake-role-store";
import type { RoleAssignmentWriteStore, RawAssignmentData } from "./role-assignment-store";

const ADMIN_UID = "admin-1";
const MEMBER_UID = "member-1";
const T0 = new Date("2026-06-01T00:00:00.000Z");
const NOW = new Date("2026-10-01T10:00:00.000Z");

/** In-memory assignment store with the same create-or-change and remove semantics as the Admin SDK store. */
function createFakeAssignmentStore(initial: Record<string, RawAssignmentData> = {}) {
  const docs = new Map<string, RawAssignmentData>(Object.entries(initial).map(([uid, data]) => [uid, { ...data }]));
  const writes: string[] = [];
  const store: RoleAssignmentWriteStore & { writes: string[]; docs: Map<string, RawAssignmentData> } = {
    docs,
    writes,
    async get(uid) {
      return docs.get(uid) === undefined ? undefined : { ...docs.get(uid) };
    },
    async getMany(uids) {
      return uids.map((uid) => (docs.get(uid) === undefined ? undefined : { ...docs.get(uid) }));
    },
    async assign(uid, roleId, actorUid, now) {
      writes.push(`assign:${uid}`);
      const existing = docs.get(uid);
      if (existing === undefined) {
        docs.set(uid, { roleId, createdAt: now, createdBy: actorUid });
        return { created: true };
      }
      docs.set(uid, { ...existing, roleId, updatedAt: now, updatedBy: actorUid });
      return { created: false };
    },
    async remove(uid) {
      writes.push(`remove:${uid}`);
      const existed = docs.delete(uid);
      return { removed: existed };
    },
  };
  return store;
}

function deps(overrides: Partial<RoleAssignmentDeps> = {}): RoleAssignmentDeps {
  return {
    verifyToken: vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: "admin@example.com", email_verified: true }),
    isSuperadmin: async (uid: string) => uid === ADMIN_UID,
    readFence: async () => ({ kind: "none" }),
    assignments: createFakeAssignmentStore(),
    roles: createFakeRoleStore(),
    now: () => NOW,
    ...overrides,
  };
}

async function seedRole(roles: ReturnType<typeof createFakeRoleStore>, extra: Record<string, unknown> = {}): Promise<string> {
  return roles.create({ name: "Backend-utvikler", description: "Bygger tjenester.", createdAt: T0, createdBy: ADMIN_UID, ...extra });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assignRoleToUser (admin assign and change)", () => {
  it("assigns an active role to a user and reports a new assignment", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles);
    const assignments = createFakeAssignmentStore();

    const result = await assignRoleToUser("token", MEMBER_UID, { roleId }, deps({ roles, assignments }));

    expect(result).toEqual({ ok: true, assignment: { roleId }, created: true });
    expect(assignments.docs.get(MEMBER_UID)).toEqual({ roleId, createdAt: NOW, createdBy: ADMIN_UID });
  });

  it("changes an existing assignment to another role, keeping the original creation record", async () => {
    const roles = createFakeRoleStore();
    const first = await seedRole(roles);
    const second = await seedRole(roles, { name: "Designer" });
    const assignments = createFakeAssignmentStore({ [MEMBER_UID]: { roleId: first, createdAt: T0, createdBy: "admin-0" } });

    const result = await assignRoleToUser("token", MEMBER_UID, { roleId: second }, deps({ roles, assignments }));

    expect(result).toEqual({ ok: true, assignment: { roleId: second }, created: false });
    expect(assignments.docs.get(MEMBER_UID)).toMatchObject({ roleId: second, createdAt: T0, createdBy: "admin-0", updatedAt: NOW, updatedBy: ADMIN_UID });
  });

  it("refuses an unauthenticated caller and writes nothing", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles);
    const assignments = createFakeAssignmentStore();

    const result = await assignRoleToUser("token", MEMBER_UID, { roleId }, deps({
      roles,
      assignments,
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
    }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(assignments.writes).toEqual([]);
  });

  it("refuses a signed-in person who is not an administrator and writes nothing", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles);
    const assignments = createFakeAssignmentStore();

    const result = await assignRoleToUser("token", MEMBER_UID, { roleId }, deps({
      roles,
      assignments,
      verifyToken: vi.fn().mockResolvedValue({ uid: "member-2", email: "m@example.com", email_verified: true }),
    }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(assignments.writes).toEqual([]);
  });

  it("refuses an administrator who assigns a role to themselves, and writes nothing", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles);
    const assignments = createFakeAssignmentStore();

    const result = await assignRoleToUser("token", ADMIN_UID, { roleId }, deps({ roles, assignments }));

    expect(result).toEqual({ ok: false, error: "self_assignment" });
    expect(assignments.writes).toEqual([]);
  });

  it("refuses an archived role, and writes nothing, so no archived role receives a new assignment", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles, { archivedAt: T0, archivedBy: ADMIN_UID });
    const assignments = createFakeAssignmentStore();

    const result = await assignRoleToUser("token", MEMBER_UID, { roleId }, deps({ roles, assignments }));

    expect(result).toEqual({ ok: false, error: "role_archived" });
    expect(assignments.writes).toEqual([]);
  });

  it("refuses a missing or unreadable role as role_not_found, and writes nothing", async () => {
    const roles = createFakeRoleStore();
    roles.seedRaw("broken", { name: "Skjult", createdAt: T0, createdBy: ADMIN_UID, expectations: [] });
    const assignments = createFakeAssignmentStore();

    expect(await assignRoleToUser("token", MEMBER_UID, { roleId: "missing" }, deps({ roles, assignments }))).toEqual({
      ok: false,
      error: "role_not_found",
    });
    expect(await assignRoleToUser("token", MEMBER_UID, { roleId: "broken" }, deps({ roles, assignments }))).toEqual({
      ok: false,
      error: "role_not_found",
    });
    expect(assignments.writes).toEqual([]);
  });

  it.each([
    ["an extra identity field in the body", { roleId: "r", uid: "someone-else" }],
    ["an audit field in the body", { roleId: "r", createdBy: "spoof" }],
    ["a missing role id", {}],
    ["a role id that cannot address a document", { roleId: "bad/id" }],
    ["a non-object body", "r"],
  ])("refuses %s with invalid_input and writes nothing", async (_label, input) => {
    const assignments = createFakeAssignmentStore();

    const result = await assignRoleToUser("token", MEMBER_UID, input, deps({ assignments }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(assignments.writes).toEqual([]);
  });

  it("refuses a target uid that cannot address an assignment document", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles);
    const assignments = createFakeAssignmentStore();

    expect(await assignRoleToUser("token", "bad/uid", { roleId }, deps({ roles, assignments }))).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(assignments.writes).toEqual([]);
  });

  it("reports an erasure in progress for the target as erasure_in_progress, and never persists", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles);
    const assignments = createFakeAssignmentStore();
    vi.spyOn(assignments, "assign").mockRejectedValue(new ErasureWriteRefused());

    const result = await assignRoleToUser("token", MEMBER_UID, { roleId }, deps({ roles, assignments }));

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(assignments.docs.has(MEMBER_UID)).toBe(false);
  });

  it("reports a write failure as the neutral persistence_failed, with no detail", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles);
    const assignments = createFakeAssignmentStore();
    vi.spyOn(assignments, "assign").mockRejectedValue(new Error("boom: Backend-utvikler"));

    const result = await assignRoleToUser("token", MEMBER_UID, { roleId }, deps({ roles, assignments }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("Backend-utvikler");
  });
});

describe("removeRoleAssignment (admin remove)", () => {
  it("removes an existing assignment and leaves the shared role definition in place", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles);
    const assignments = createFakeAssignmentStore({ [MEMBER_UID]: { roleId, createdAt: T0, createdBy: ADMIN_UID } });

    const result = await removeRoleAssignment("token", MEMBER_UID, deps({ roles, assignments }));

    expect(result).toEqual({ ok: true, removed: true });
    expect(assignments.docs.has(MEMBER_UID)).toBe(false);
    expect(await roles.get(roleId)).toMatchObject({ name: "Backend-utvikler" });
  });

  it("treats removing an absent assignment as an idempotent success that reports nothing removed", async () => {
    const assignments = createFakeAssignmentStore();

    expect(await removeRoleAssignment("token", MEMBER_UID, deps({ assignments }))).toEqual({ ok: true, removed: false });
  });

  it("refuses a non-administrator and removes nothing", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles);
    const assignments = createFakeAssignmentStore({ [MEMBER_UID]: { roleId, createdAt: T0, createdBy: ADMIN_UID } });

    const result = await removeRoleAssignment("token", MEMBER_UID, deps({
      roles,
      assignments,
      verifyToken: vi.fn().mockResolvedValue({ uid: "member-2", email: "m@example.com", email_verified: true }),
    }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(assignments.docs.has(MEMBER_UID)).toBe(true);
  });

  it("refuses an administrator removing their own assignment", async () => {
    const assignments = createFakeAssignmentStore({ [ADMIN_UID]: { roleId: "r", createdAt: T0, createdBy: ADMIN_UID } });

    expect(await removeRoleAssignment("token", ADMIN_UID, deps({ assignments }))).toEqual({ ok: false, error: "self_assignment" });
    expect(assignments.docs.has(ADMIN_UID)).toBe(true);
  });
});

describe("lookupRoleAssignments (admin batch read)", () => {
  it("returns the role id per uid in request order, null when none, and null for a malformed document", async () => {
    const assignments = createFakeAssignmentStore({
      "member-a": { roleId: "r1", createdAt: T0, createdBy: ADMIN_UID },
      "member-c": { roleId: "r2", createdAt: T0, createdBy: ADMIN_UID, expectations: [] },
    });

    const result = await lookupRoleAssignments("token", ["member-a", "member-b", "member-c"], deps({ assignments }));

    expect(result).toEqual({
      ok: true,
      assignments: [
        { uid: "member-a", roleId: "r1" },
        { uid: "member-b", roleId: null },
        { uid: "member-c", roleId: null },
      ],
    });
  });

  it("refuses more than 100 uids and any non-uid entry", async () => {
    const tooMany = Array.from({ length: 101 }, (_, index) => `m${index}`);

    expect(await lookupRoleAssignments("token", tooMany, deps())).toEqual({ ok: false, error: "invalid_input" });
    expect(await lookupRoleAssignments("token", ["ok", "bad/uid"], deps())).toEqual({ ok: false, error: "invalid_input" });
  });

  it("refuses a non-administrator", async () => {
    const result = await lookupRoleAssignments("token", [MEMBER_UID], deps({
      verifyToken: vi.fn().mockResolvedValue({ uid: "member-2", email: "m@example.com", email_verified: true }),
    }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("getOwnRoleAssignment (the signed-in person's own role)", () => {
  const memberVerify = () => vi.fn().mockResolvedValue({ uid: MEMBER_UID, email: "m@example.com", email_verified: true });

  it("returns the title and description of the assigned active role, and no identifiers", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles);
    const assignments = createFakeAssignmentStore({ [MEMBER_UID]: { roleId, createdAt: T0, createdBy: ADMIN_UID } });

    const result = await getOwnRoleAssignment("token", { verifyToken: memberVerify(), readFence: async () => ({ kind: "none" }), assignments, roles });

    expect(result).toEqual({
      ok: true,
      assignment: { status: "assigned", title: "Backend-utvikler", description: "Bygger tjenester." },
    });
    expect(JSON.stringify(result)).not.toContain(roleId);
    expect(JSON.stringify(result)).not.toContain(ADMIN_UID);
  });

  it("returns a concise none when the person has no assignment", async () => {
    const result = await getOwnRoleAssignment("token", {
      verifyToken: memberVerify(),
      readFence: async () => ({ kind: "none" }),
      assignments: createFakeAssignmentStore(),
      roles: createFakeRoleStore(),
    });

    expect(result).toEqual({ ok: true, assignment: { status: "none" } });
  });

  it("shows none for an archived assigned role, without substituting another role", async () => {
    const roles = createFakeRoleStore();
    const roleId = await seedRole(roles, { archivedAt: T0, archivedBy: ADMIN_UID });
    const assignments = createFakeAssignmentStore({ [MEMBER_UID]: { roleId, createdAt: T0, createdBy: ADMIN_UID } });

    const result = await getOwnRoleAssignment("token", { verifyToken: memberVerify(), readFence: async () => ({ kind: "none" }), assignments, roles });

    expect(result).toEqual({ ok: true, assignment: { status: "none" } });
  });

  it("shows none for a malformed assignment document rather than interpreting it", async () => {
    const assignments = createFakeAssignmentStore({ [MEMBER_UID]: { roleId: "r1", createdBy: ADMIN_UID } });

    const result = await getOwnRoleAssignment("token", {
      verifyToken: memberVerify(),
      readFence: async () => ({ kind: "none" }),
      assignments,
      roles: createFakeRoleStore(),
    });

    expect(result).toEqual({ ok: true, assignment: { status: "none" } });
  });

  it("refuses an unauthenticated caller before reading any assignment", async () => {
    const assignments = createFakeAssignmentStore();
    const spy = vi.spyOn(assignments, "get");

    const result = await getOwnRoleAssignment("token", {
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
      readFence: async () => ({ kind: "none" }),
      assignments,
      roles: createFakeRoleStore(),
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(spy).not.toHaveBeenCalled();
  });
});

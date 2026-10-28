import { describe, expect, it, vi } from "vitest";
import { createFakeRoleStore } from "./fake-role-store";
import { setRoleArchived, type SetRoleArchivedDeps } from "./set-role-archived";
import type { RawSkillTreeRead, RawSkillTreeReader } from "./skill-tree-seam-types";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const CREATED_AT = new Date("2026-10-01T10:00:00Z");
const ARCHIVED_AT = new Date("2026-10-04T10:00:00Z");

const validTree = {
  name: "API design",
  nodes: [
    { nodeId: "node-0", label: "Basic", order: 0 },
    { nodeId: "node-1", label: "Solid", order: 1 },
  ],
  createdAt: CREATED_AT,
  createdBy: "curator-uid",
};

const treeReader: RawSkillTreeReader = {
  async getMany(treeIds) {
    return treeIds.map((id): RawSkillTreeRead => ({ id, data: id === "api" ? validTree : undefined }));
  },
};

function seededStore(extra: Record<string, unknown> = {}) {
  const store = createFakeRoleStore();
  store.seedRaw("role-1", {
    name: "Backend engineer",
    expectations: [{ treeId: "api", expectedLevel: 2 }],
    createdAt: CREATED_AT,
    createdBy: "admin-0",
    ...extra,
  });
  return store;
}

function deps(overrides: Partial<SetRoleArchivedDeps> = {}): SetRoleArchivedDeps {
  return {
    verifyToken: vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true }),
    allowList: [ADMIN_EMAIL],
    store: seededStore(),
    treeReader,
    now: () => ARCHIVED_AT,
    ...overrides,
  };
}

describe("setRoleArchived", () => {
  it("refuses a non-admin caller with zero writes", async () => {
    const store = seededStore();
    const spy = vi.spyOn(store, "update");
    expect(await setRoleArchived("token", "role-1", true, deps({ store, allowList: [] }))).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a non-boolean archived value with zero writes", async () => {
    const store = seededStore();
    const spy = vi.spyOn(store, "update");
    expect(await setRoleArchived("token", "role-1", "yes", deps({ store }))).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns not_found, not persistence_failed, for a roleId that cannot address a document (PG-9)", async () => {
    expect(await setRoleArchived("token", "a/b", true, deps())).toEqual({ ok: false, error: "not_found" });
  });

  it("returns not_found for an absent or malformed role", async () => {
    expect(await setRoleArchived("token", "missing", true, deps())).toEqual({ ok: false, error: "not_found" });
    const store = createFakeRoleStore();
    store.seedRaw("bad", { name: "", expectations: [], createdAt: CREATED_AT, createdBy: "x" });
    expect(await setRoleArchived("token", "bad", true, deps({ store }))).toEqual({ ok: false, error: "not_found" });
  });

  it("archives with archivedAt and archivedBy, and returns the archived DTO", async () => {
    const store = seededStore();
    const result = await setRoleArchived("token", "role-1", true, deps({ store }));

    expect(result.ok && result.role).toMatchObject({ roleId: "role-1", archived: true, createdAt: CREATED_AT });
    expect(result.ok && result.role).not.toHaveProperty("updatedAt");
    expect(await store.get("role-1")).toMatchObject({ archivedAt: ARCHIVED_AT, archivedBy: ADMIN_UID });
    expect(JSON.stringify(result)).not.toContain("archivedBy");
  });

  it("archiving an already archived role is a no-op that keeps archivedAt and writes nothing", async () => {
    const store = seededStore({ archivedAt: CREATED_AT, archivedBy: "admin-2" });
    const spy = vi.spyOn(store, "update");
    const result = await setRoleArchived("token", "role-1", true, deps({ store }));

    expect(result.ok && result.role.archived).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(await store.get("role-1")).toMatchObject({ archivedAt: CREATED_AT, archivedBy: "admin-2" });
  });

  it("restores by removing archivedAt and archivedBy, and never touches updatedAt", async () => {
    const store = seededStore({ archivedAt: CREATED_AT, archivedBy: "admin-2" });
    const result = await setRoleArchived("token", "role-1", false, deps({ store }));

    expect(result.ok && result.role.archived).toBe(false);
    const restored = await store.get("role-1");
    expect(restored).not.toHaveProperty("archivedAt");
    expect(restored).not.toHaveProperty("archivedBy");
    expect(restored).not.toHaveProperty("updatedAt");
    expect(restored?.createdAt).toEqual(CREATED_AT);
  });

  it("restoring an active role is a no-op that writes nothing", async () => {
    const store = seededStore();
    const spy = vi.spyOn(store, "update");
    const result = await setRoleArchived("token", "role-1", false, deps({ store }));
    expect(result.ok && result.role.archived).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("archive then restore round-trips to the active state with createdAt unchanged", async () => {
    const store = seededStore();
    await setRoleArchived("token", "role-1", true, deps({ store }));
    await setRoleArchived("token", "role-1", false, deps({ store }));
    expect(await store.get("role-1")).toMatchObject({ name: "Backend engineer", createdAt: CREATED_AT });
    expect(await store.get("role-1")).not.toHaveProperty("archivedAt");
  });
});

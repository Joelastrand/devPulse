import { describe, expect, it, vi } from "vitest";
import { createFakeRoleStore } from "./fake-role-store";
import { updateRole, type UpdateRoleDeps } from "./update-role";
import type { RawSkillTreeRead, RawSkillTreeReader } from "./skill-tree-seam-types";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const CREATED_AT = new Date("2026-10-01T10:00:00Z");
const EDITED_AT = new Date("2026-10-03T10:00:00Z");

const validTree = {
  name: "API design",
  nodes: [
    { nodeId: "node-0", label: "Basic", order: 0 },
    { nodeId: "node-1", label: "Solid", order: 1 },
  ],
  createdAt: CREATED_AT,
  createdBy: "curator-uid",
};

function treeReader(docs: Record<string, unknown>, failOn?: string): RawSkillTreeReader {
  return {
    async getMany(treeIds) {
      if (failOn !== undefined && treeIds.includes(failOn)) throw new Error("boom");
      return treeIds.map((id): RawSkillTreeRead => ({ id, data: docs[id] }));
    },
  };
}

function seededStore(extra: Record<string, unknown> = {}) {
  const store = createFakeRoleStore();
  store.seedRaw("role-1", {
    name: "Backend engineer",
    description: "Owns APIs",
    expectations: [
      { treeId: "api", expectedLevel: 2 },
      { treeId: "ops", expectedLevel: 3 },
    ],
    createdAt: CREATED_AT,
    createdBy: "admin-0",
    ...extra,
  });
  return store;
}

function deps(overrides: Partial<UpdateRoleDeps> = {}): UpdateRoleDeps {
  return {
    verifyToken: vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: ADMIN_EMAIL, email_verified: true }),
    allowList: [ADMIN_EMAIL],
    store: seededStore(),
    treeReader: treeReader({ api: validTree, ops: { ...validTree, name: "Operations" } }),
    now: () => EDITED_AT,
    ...overrides,
  };
}

describe("updateRole", () => {
  it("refuses a non-admin caller with zero writes", async () => {
    const store = seededStore();
    const spy = vi.spyOn(store, "update");
    const result = await updateRole("token", "role-1", { name: "New" }, deps({ store, allowList: [] }));
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an empty patch with invalid_input and zero writes", async () => {
    const store = seededStore();
    const spy = vi.spyOn(store, "update");
    expect(await updateRole("token", "role-1", {}, deps({ store }))).toEqual({ ok: false, error: "invalid_input" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an invalid field with zero writes", async () => {
    const store = seededStore();
    const spy = vi.spyOn(store, "update");
    expect(await updateRole("token", "role-1", { name: "" }, deps({ store }))).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns not_found for an absent role", async () => {
    expect(await updateRole("token", "missing", { name: "New" }, deps())).toEqual({ ok: false, error: "not_found" });
  });

  it("returns not_found, not persistence_failed, for a roleId that cannot address a document (PG-9)", async () => {
    expect(await updateRole("token", "a/b", { name: "New" }, deps())).toEqual({ ok: false, error: "not_found" });
  });

  it("returns not_found for a malformed stored role, without repairing it", async () => {
    const store = createFakeRoleStore();
    store.seedRaw("role-1", { name: "", expectations: [], createdAt: CREATED_AT, createdBy: "x" });
    const spy = vi.spyOn(store, "update");
    expect(await updateRole("token", "role-1", { name: "New" }, deps({ store }))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an archived role with role_archived and zero writes", async () => {
    const store = seededStore({ archivedAt: CREATED_AT, archivedBy: "admin-2" });
    const spy = vi.spyOn(store, "update");
    expect(await updateRole("token", "role-1", { name: "New" }, deps({ store }))).toEqual({
      ok: false,
      error: "role_archived",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("applies a partial rename, leaves other fields untouched, and keeps createdAt", async () => {
    const store = seededStore();
    const result = await updateRole("token", "role-1", { name: "Platform engineer" }, deps({ store }));

    expect(result.ok && result.role).toEqual({
      roleId: "role-1",
      name: "Platform engineer",
      description: "Owns APIs",
      expectations: [
        { treeId: "api", treeName: "API design", expectedLevel: 2 },
        { treeId: "ops", treeName: "Operations", expectedLevel: 3 },
      ],
      archived: false,
      createdAt: CREATED_AT,
      updatedAt: EDITED_AT,
    });
    expect(await store.get("role-1")).toMatchObject({
      name: "Platform engineer",
      description: "Owns APIs",
      createdAt: CREATED_AT,
      createdBy: "admin-0",
      updatedAt: EDITED_AT,
      updatedBy: ADMIN_UID,
    });
  });

  it("replaces the whole expectations array, removing entries not in the new list", async () => {
    const store = seededStore();
    await updateRole("token", "role-1", { expectations: [{ treeId: "api", expectedLevel: 4 }] }, deps({ store }));
    expect((await store.get("role-1"))?.expectations).toEqual([{ treeId: "api", expectedLevel: 4 }]);
  });

  it("clears the stored description when the patch trims to empty", async () => {
    const store = seededStore();
    const result = await updateRole("token", "role-1", { description: "   " }, deps({ store }));
    expect(result.ok && result.role).not.toHaveProperty("description");
    expect(await store.get("role-1")).not.toHaveProperty("description");
  });

  it("refuses an unknown or invalid SkillTree in a replaced expectations array, with zero writes", async () => {
    const store = seededStore();
    const spy = vi.spyOn(store, "update");
    const result = await updateRole(
      "token",
      "role-1",
      { expectations: [{ treeId: "gone", expectedLevel: 2 }] },
      deps({ store }),
    );
    expect(result).toEqual({ ok: false, error: "skill_not_found" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a SkillTree read failure as persistence_failed with zero writes", async () => {
    const store = seededStore();
    const spy = vi.spyOn(store, "update");
    const result = await updateRole(
      "token",
      "role-1",
      { expectations: [{ treeId: "api", expectedLevel: 2 }] },
      deps({ store, treeReader: treeReader({ api: validTree }, "api") }),
    );
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("never exposes updatedBy or createdBy in the DTO", async () => {
    const result = await updateRole("token", "role-1", { name: "New" }, deps());
    const json = JSON.stringify(result);
    expect(json).not.toContain("updatedBy");
    expect(json).not.toContain("createdBy");
    expect(json).not.toContain(ADMIN_UID);
  });
});

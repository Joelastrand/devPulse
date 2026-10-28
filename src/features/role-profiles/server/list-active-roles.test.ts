import { describe, expect, it, vi } from "vitest";
import { createFakeRoleStore } from "./fake-role-store";
import { listActiveRolesForPerson } from "./list-active-roles";
import type { RawSkillTreeRead, RawSkillTreeReader } from "./skill-tree-seam-types";

const BASE = new Date("2026-10-01T10:00:00Z");
const at = (minutes: number) => new Date(BASE.getTime() + minutes * 60_000);

const validTree = {
  name: "API design",
  nodes: [
    { nodeId: "node-0", label: "Basic", order: 0 },
    { nodeId: "node-1", label: "Solid", order: 1 },
  ],
  createdAt: BASE,
  createdBy: "curator-uid",
};

const treeReader: RawSkillTreeReader = {
  async getMany(treeIds) {
    return treeIds.map((id): RawSkillTreeRead => ({ id, data: id === "api" ? validTree : undefined }));
  },
};

function seed(store: ReturnType<typeof createFakeRoleStore>, id: string, minute: number, extra: Record<string, unknown> = {}) {
  store.seedRaw(id, { name: `Role ${id}`, expectations: [], createdAt: at(minute), createdBy: "admin-1", ...extra });
}

describe("listActiveRolesForPerson", () => {
  it("excludes archived roles and malformed documents without exposing their content", async () => {
    const store = createFakeRoleStore();
    seed(store, "active", 1);
    seed(store, "archived", 2, { archivedAt: at(3), archivedBy: "admin-2" });
    store.seedRaw("malformed", { name: "", expectations: [], createdAt: at(0), createdBy: "admin-1" });

    const result = await listActiveRolesForPerson({ store, treeReader });

    expect(result.ok && result.roles.map((role) => role.roleId)).toEqual(["active"]);
    expect(JSON.stringify(result)).not.toContain("malformed");
  });

  it("includes a zero-expectation active role as not selectable with an empty expectations list", async () => {
    const store = createFakeRoleStore();
    seed(store, "draft", 1);
    const result = await listActiveRolesForPerson({ store, treeReader });
    expect(result).toEqual({
      ok: true,
      truncated: false,
      roles: [{ roleId: "draft", name: "Role draft", selectable: false, expectations: [] }],
    });
  });

  it("marks a role selectable when at least one expectation resolves to a valid SkillTree", async () => {
    const store = createFakeRoleStore();
    seed(store, "mixed", 1, {
      expectations: [
        { treeId: "api", expectedLevel: 2 },
        { treeId: "gone", expectedLevel: 3 },
      ],
    });
    const result = await listActiveRolesForPerson({ store, treeReader });
    expect(result.ok && result.roles[0]).toEqual({
      roleId: "mixed",
      name: "Role mixed",
      selectable: true,
      expectations: [
        { treeId: "api", treeName: "API design", expectedLevel: 2 },
        { treeId: "gone", treeName: null, expectedLevel: 3 },
      ],
    });
  });

  it("marks a role not selectable when every expectation is unresolved", async () => {
    const store = createFakeRoleStore();
    seed(store, "unavailable", 1, { expectations: [{ treeId: "gone", expectedLevel: 2 }] });
    const result = await listActiveRolesForPerson({ store, treeReader });
    expect(result.ok && result.roles[0]?.selectable).toBe(false);
  });

  it("returns only the PG-8 allow-listed keys and keeps description when present", async () => {
    const store = createFakeRoleStore();
    seed(store, "r", 1, { description: "Owns APIs", expectations: [{ treeId: "api", expectedLevel: 2 }] });
    const result = await listActiveRolesForPerson({ store, treeReader });
    expect(result.ok && Object.keys(result.roles[0] ?? {}).sort()).toEqual(
      ["description", "expectations", "name", "roleId", "selectable"],
    );
    expect(result.ok && result.roles[0]?.description).toBe("Owns APIs");
    expect(JSON.stringify(result)).not.toMatch(/createdBy|updatedBy|archivedBy|uid/);
  });

  it("reports truncated when a 51st raw document exists", async () => {
    const store = createFakeRoleStore();
    for (let index = 0; index < 51; index += 1) seed(store, `r-${index}`, index);
    const result = await listActiveRolesForPerson({ store, treeReader });
    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.roles).toHaveLength(50);
  });

  it("reports a read failure as a neutral persistence_failed", async () => {
    const store = createFakeRoleStore();
    seed(store, "r", 1, { expectations: [{ treeId: "api", expectedLevel: 2 }] });
    const failing: RawSkillTreeReader = { getMany: vi.fn().mockRejectedValue(new Error("boom")) };
    expect(await listActiveRolesForPerson({ store, treeReader: failing })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
  });
});

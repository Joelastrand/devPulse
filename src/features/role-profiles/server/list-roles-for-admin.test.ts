import { describe, expect, it, vi } from "vitest";
import { createFakeRoleStore } from "./fake-role-store";
import { listRolesForAdmin, type ListRolesForAdminDeps } from "./list-roles-for-admin";
import type { RawSkillTreeRead, RawSkillTreeReader } from "./skill-tree-seam-types";

const ADMIN_EMAIL = "admin@example.com";
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

function treeReader(docs: Record<string, unknown>, failOn?: string): RawSkillTreeReader {
  return {
    async getMany(treeIds) {
      if (failOn !== undefined && treeIds.includes(failOn)) throw new Error("boom");
      return treeIds.map((id): RawSkillTreeRead => ({ id, data: docs[id] }));
    },
  };
}

function deps(overrides: Partial<ListRolesForAdminDeps> = {}): ListRolesForAdminDeps {
  return {
    verifyToken: vi.fn().mockResolvedValue({ uid: "admin-1", email: ADMIN_EMAIL, email_verified: true }),
    allowList: [ADMIN_EMAIL],
    store: createFakeRoleStore(),
    treeReader: treeReader({ api: validTree }),
    ...overrides,
  };
}

function seedValid(store: ReturnType<typeof createFakeRoleStore>, id: string, minute: number, extra: Record<string, unknown> = {}) {
  store.seedRaw(id, {
    name: `Role ${id}`,
    expectations: [{ treeId: "api", expectedLevel: 2 }],
    createdAt: at(minute),
    createdBy: "admin-1",
    ...extra,
  });
}

describe("listRolesForAdmin", () => {
  it("refuses a non-admin caller", async () => {
    const result = await listRolesForAdmin("token", {}, deps({ allowList: [] }));
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses a non-boolean includeArchived", async () => {
    const result = await listRolesForAdmin("token", { includeArchived: "yes" }, deps());
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });

  it("returns admin DTOs in createdAt order, with treeName from the SkillTree and no audit fields", async () => {
    const store = createFakeRoleStore();
    seedValid(store, "later", 5);
    seedValid(store, "earlier", 1);
    const result = await listRolesForAdmin("token", {}, deps({ store }));
    expect(result).toEqual({
      ok: true,
      truncated: false,
      roles: [
        {
          roleId: "earlier",
          name: "Role earlier",
          expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 2 }],
          archived: false,
          createdAt: at(1),
        },
        {
          roleId: "later",
          name: "Role later",
          expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 2 }],
          archived: false,
          createdAt: at(5),
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("createdBy");
  });

  it("reports a null treeName for a missing SkillTree", async () => {
    const store = createFakeRoleStore();
    seedValid(store, "r", 1, { expectations: [{ treeId: "gone", expectedLevel: 4 }] });
    const result = await listRolesForAdmin("token", {}, deps({ store, treeReader: treeReader({}) }));
    expect(result.ok && result.roles[0]?.expectations).toEqual([{ treeId: "gone", treeName: null, expectedLevel: 4 }]);
  });

  it("includes archived roles by default and omits them when includeArchived is false", async () => {
    const store = createFakeRoleStore();
    seedValid(store, "active", 1);
    seedValid(store, "archived", 2, { archivedAt: at(3), archivedBy: "admin-2" });

    const included = await listRolesForAdmin("token", {}, deps({ store }));
    expect(included.ok && included.roles.map((role) => [role.roleId, role.archived])).toEqual([
      ["active", false],
      ["archived", true],
    ]);

    const excluded = await listRolesForAdmin("token", { includeArchived: false }, deps({ store }));
    expect(excluded.ok && excluded.roles.map((role) => role.roleId)).toEqual(["active"]);
  });

  it("skips a malformed document silently but lets it consume a window slot, and sets truncated on the 51st raw document", async () => {
    const store = createFakeRoleStore();
    store.seedRaw("malformed", { name: "", expectations: [], createdAt: at(0), createdBy: "admin-1" });
    for (let index = 1; index <= 49; index += 1) {
      seedValid(store, `valid-${index}`, index);
    }
    seedValid(store, "beyond-window", 50);

    const result = await listRolesForAdmin("token", {}, deps({ store }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.roles).toHaveLength(49);
    expect(result.roles.map((role) => role.roleId)).not.toContain("malformed");
    expect(result.roles.map((role) => role.roleId)).not.toContain("beyond-window");
  });

  it("reports truncated false when exactly 50 raw documents exist", async () => {
    const store = createFakeRoleStore();
    for (let index = 0; index < 50; index += 1) {
      seedValid(store, `valid-${index}`, index);
    }
    const result = await listRolesForAdmin("token", {}, deps({ store }));
    expect(result.ok && result.truncated).toBe(false);
  });

  it("reports a SkillTree read failure as persistence_failed, never as missing", async () => {
    const store = createFakeRoleStore();
    seedValid(store, "r", 1);
    const result = await listRolesForAdmin("token", {}, deps({ store, treeReader: treeReader({ api: validTree }, "api") }));
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });
});

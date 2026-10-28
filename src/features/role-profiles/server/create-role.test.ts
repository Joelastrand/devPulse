import { afterEach, describe, expect, it, vi } from "vitest";
import { createRole, type CreateRoleDeps } from "./create-role";
import { createFakeRoleStore } from "./fake-role-store";
import type { RawSkillTreeRead, RawSkillTreeReader } from "./skill-tree-seam-types";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_UID = "admin-1";
const NOW = new Date("2026-10-01T10:00:00Z");

const validTree = {
  name: "API design",
  nodes: [
    { nodeId: "node-0", label: "Basic", order: 0 },
    { nodeId: "node-1", label: "Solid", order: 1 },
  ],
  createdAt: NOW,
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

function verifyAs(uid: string) {
  return vi.fn().mockResolvedValue({ uid, email: ADMIN_EMAIL, email_verified: true });
}

function deps(overrides: Partial<CreateRoleDeps> = {}): CreateRoleDeps {
  return {
    verifyToken: verifyAs(ADMIN_UID),
    allowList: [ADMIN_EMAIL],
    store: createFakeRoleStore({ generateId: () => "role-1" }),
    treeReader: treeReader({ api: validTree }),
    now: () => NOW,
    ...overrides,
  };
}

const VALID_INPUT = { name: "  Backend engineer  ", expectations: [{ treeId: "api", expectedLevel: 3 }] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRole", () => {
  it("refuses an unauthenticated caller", async () => {
    const store = createFakeRoleStore();
    const spy = vi.spyOn(store, "create");
    const result = await createRole("token", VALID_INPUT, {
      ...deps({ store }),
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
    });
    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a non-admin caller with zero writes", async () => {
    const store = createFakeRoleStore();
    const spy = vi.spyOn(store, "create");
    const result = await createRole("token", VALID_INPUT, deps({ store, allowList: [] }));
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an invalid body with zero writes", async () => {
    const store = createFakeRoleStore();
    const spy = vi.spyOn(store, "create");
    const result = await createRole("token", { name: "", expectations: [] }, deps({ store }));
    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an unknown treeId with zero writes", async () => {
    const store = createFakeRoleStore();
    const spy = vi.spyOn(store, "create");
    const result = await createRole("token", VALID_INPUT, deps({ store, treeReader: treeReader({}) }));
    expect(result).toEqual({ ok: false, error: "skill_not_found" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a referenced SkillTree that is invalid, with zero writes", async () => {
    const store = createFakeRoleStore();
    const spy = vi.spyOn(store, "create");
    const result = await createRole(
      "token",
      VALID_INPUT,
      deps({ store, treeReader: treeReader({ api: { ...validTree, name: "   " } }) }),
    );
    expect(result).toEqual({ ok: false, error: "skill_not_found" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("writes the exact stored shape with internal fields and returns an allow-listed admin DTO", async () => {
    const store = createFakeRoleStore({ generateId: () => "role-1" });
    const result = await createRole("token", VALID_INPUT, deps({ store }));

    expect(result).toEqual({
      ok: true,
      role: {
        roleId: "role-1",
        name: "Backend engineer",
        expectations: [{ treeId: "api", treeName: "API design", expectedLevel: 3 }],
        archived: false,
        createdAt: NOW,
      },
    });
    expect(await store.get("role-1")).toStrictEqual({
      name: "Backend engineer",
      expectations: [{ treeId: "api", expectedLevel: 3 }],
      createdAt: NOW,
      createdBy: ADMIN_UID,
    });
  });

  it("never returns createdBy, updatedBy, archivedBy or uid in the DTO", async () => {
    const result = await createRole("token", VALID_INPUT, deps());
    expect(result.ok).toBe(true);
    const json = JSON.stringify(result);
    expect(json).not.toContain("createdBy");
    expect(json).not.toContain("updatedBy");
    expect(json).not.toContain("archivedBy");
    expect(json).not.toContain(ADMIN_UID);
  });

  it("refuses the 51st role when 50 documents exist, counting archived and malformed documents", async () => {
    const store = createFakeRoleStore();
    for (let index = 0; index < 48; index += 1) {
      store.seedRaw(`valid-${index}`, { name: `R${index}`, expectations: [], createdAt: NOW, createdBy: "x" });
    }
    store.seedRaw("archived", { name: "Old", expectations: [], createdAt: NOW, createdBy: "x", archivedAt: NOW });
    store.seedRaw("malformed", { name: "", expectations: [], createdAt: NOW, createdBy: "x" });
    const spy = vi.spyOn(store, "create");

    const result = await createRole("token", VALID_INPUT, deps({ store }));

    expect(result).toEqual({ ok: false, error: "cap_reached" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows a create when fewer than 50 documents exist", async () => {
    const store = createFakeRoleStore({ generateId: () => "role-new" });
    for (let index = 0; index < 49; index += 1) {
      store.seedRaw(`valid-${index}`, { name: `R${index}`, expectations: [], createdAt: NOW, createdBy: "x" });
    }
    const result = await createRole("token", VALID_INPUT, deps({ store }));
    expect(result.ok).toBe(true);
  });

  it("reports a SkillTree read failure as persistence_failed and never as a missing tree", async () => {
    const store = createFakeRoleStore();
    const spy = vi.spyOn(store, "create");
    const result = await createRole("token", VALID_INPUT, deps({ store, treeReader: treeReader({ api: validTree }, "api") }));
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("writes no role name or description to any log call", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")];
    await createRole("token", { ...VALID_INPUT, description: "Secret wording" }, deps());
    for (const spy of logs) {
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Backend engineer|Secret wording/);
    }
  });
});

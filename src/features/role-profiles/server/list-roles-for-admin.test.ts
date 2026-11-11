import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { listRolesForAdmin, type ListRolesForAdminDeps } from "./list-roles-for-admin";
import { createFakeRoleStore } from "./fake-role-store";

const ADMIN_UID = "admin-1";
const T0 = new Date("2026-06-01T00:00:00.000Z");

function deps(overrides: Partial<ListRolesForAdminDeps> = {}): ListRolesForAdminDeps {
  return {
    verifyToken: vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: "admin@example.com", email_verified: true }),
    isSuperadmin: async (uid: string) => uid === ADMIN_UID,
    readFence: async () => ({ kind: "none" }),
    store: createFakeRoleStore(),
    ...overrides,
  };
}

describe("listRolesForAdmin", () => {
  it("returns admin views in createdAt order with title, description and lifecycle only", async () => {
    const store = createFakeRoleStore();
    await store.create({ name: "Senere", description: "Beskrivelse B", createdAt: new Date(T0.getTime() + 1000), createdBy: ADMIN_UID });
    await store.create({ name: "Tidligere", description: "Beskrivelse A", createdAt: T0, createdBy: ADMIN_UID, updatedBy: ADMIN_UID, updatedAt: new Date(T0.getTime() + 5) });

    const result = await listRolesForAdmin("token", {}, deps({ store }));

    expect(result).toEqual({
      ok: true,
      truncated: false,
      roles: [
        { roleId: "fake-role-2", name: "Tidligere", description: "Beskrivelse A", archived: false, createdAt: T0, updatedAt: new Date(T0.getTime() + 5) },
        { roleId: "fake-role-1", name: "Senere", description: "Beskrivelse B", archived: false, createdAt: new Date(T0.getTime() + 1000) },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("createdBy");
    expect(serialized).not.toContain("updatedBy");
    expect(serialized).not.toContain("expectations");
  });

  it("includes archived roles by default and omits them when includeArchived is false", async () => {
    const store = createFakeRoleStore();
    await store.create({ name: "Aktiv", description: "Beskrivelse", createdAt: T0, createdBy: ADMIN_UID });
    await store.create({ name: "Arkivert", description: "Beskrivelse", createdAt: T0, createdBy: ADMIN_UID, archivedAt: T0, archivedBy: ADMIN_UID });

    const all = await listRolesForAdmin("token", {}, deps({ store }));
    const active = await listRolesForAdmin("token", { includeArchived: false }, deps({ store }));

    expect(all.ok && all.roles.map((role) => [role.name, role.archived])).toEqual([
      ["Aktiv", false],
      ["Arkivert", true],
    ]);
    expect(active.ok && active.roles.map((role) => role.name)).toEqual(["Aktiv"]);
  });

  it("refuses a non-boolean includeArchived with invalid_input", async () => {
    const result = await listRolesForAdmin("token", { includeArchived: "yes" }, deps());
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });

  it("refuses a non-admin with forbidden and reads nothing", async () => {
    const store = createFakeRoleStore();
    const spy = vi.spyOn(store, "listWindow");

    const result = await listRolesForAdmin(
      "token",
      {},
      deps({ store, verifyToken: vi.fn().mockResolvedValue({ uid: "member-1", email: "m@example.com", email_verified: true }) }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips a malformed document silently, lets it consume a window slot, and sets truncated on the 51st raw document", async () => {
    const store = createFakeRoleStore();
    store.seedRaw("broken", { name: "Skjult", createdAt: T0, createdBy: ADMIN_UID, expectations: [] });
    for (let index = 0; index < 50; index += 1) {
      await store.create({ name: `Rolle ${index}`, description: "Beskrivelse", createdAt: new Date(T0.getTime() + index + 1), createdBy: ADMIN_UID });
    }

    const result = await listRolesForAdmin("token", {}, deps({ store }));

    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.roles).toHaveLength(49);
    expect(JSON.stringify(result)).not.toContain("Skjult");
  });

  it("reports a read failure as persistence_failed, never as an empty list", async () => {
    const store = createFakeRoleStore();
    vi.spyOn(store, "listWindow").mockRejectedValue(new Error("unavailable"));

    expect(await listRolesForAdmin("token", {}, deps({ store }))).toEqual({ ok: false, error: "persistence_failed" });
  });
});

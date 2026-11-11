import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { updateRole, type UpdateRoleDeps } from "./update-role";
import { createFakeRoleStore } from "./fake-role-store";

const ADMIN_UID = "admin-1";
const T0 = new Date("2026-06-01T00:00:00.000Z");
const T1 = new Date("2026-10-01T10:00:00.000Z");

function deps(overrides: Partial<UpdateRoleDeps> = {}): UpdateRoleDeps {
  return {
    verifyToken: vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: "admin@example.com", email_verified: true }),
    isSuperadmin: async (uid: string) => uid === ADMIN_UID,
    readFence: async () => ({ kind: "none" }),
    store: createFakeRoleStore(),
    now: () => T1,
    ...overrides,
  };
}

async function seedRole(store: ReturnType<typeof createFakeRoleStore>, extra: Record<string, unknown> = {}): Promise<string> {
  return store.create({ name: "Utvikler", description: "Bygger tjenester", createdAt: T0, createdBy: ADMIN_UID, ...extra });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateRole", () => {
  it("changes the title and keeps the description and creation time", async () => {
    const store = createFakeRoleStore();
    const roleId = await seedRole(store);

    const result = await updateRole("token", roleId, { name: "Senior utvikler" }, deps({ store }));

    expect(result).toEqual({
      ok: true,
      role: {
        roleId,
        name: "Senior utvikler",
        description: "Bygger tjenester",
        archived: false,
        createdAt: T0,
        updatedAt: T1,
      },
    });
  });

  it("replaces the description", async () => {
    const store = createFakeRoleStore();
    const roleId = await seedRole(store);

    const result = await updateRole("token", roleId, { description: "  Ny beskrivelse  " }, deps({ store }));

    expect(result.ok && result.role.description).toBe("Ny beskrivelse");
  });

  it("refuses an empty description, which cannot clear a required field", async () => {
    const store = createFakeRoleStore();
    const roleId = await seedRole(store);
    const spy = vi.spyOn(store, "update");

    const result = await updateRole("token", roleId, { description: "   " }, deps({ store }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an empty body with invalid_input and writes nothing", async () => {
    const store = createFakeRoleStore();
    const roleId = await seedRole(store);
    const spy = vi.spyOn(store, "update");

    expect(await updateRole("token", roleId, {}, deps({ store }))).toEqual({ ok: false, error: "invalid_input" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an unknown field such as expectations", async () => {
    const store = createFakeRoleStore();
    const roleId = await seedRole(store);

    expect(await updateRole("token", roleId, { expectations: [] }, deps({ store }))).toEqual({
      ok: false,
      error: "invalid_input",
    });
  });

  it("refuses an archived role with role_archived and writes nothing", async () => {
    const store = createFakeRoleStore();
    const roleId = await seedRole(store, { archivedAt: T0, archivedBy: ADMIN_UID });
    const spy = vi.spyOn(store, "update");

    expect(await updateRole("token", roleId, { name: "Ny" }, deps({ store }))).toEqual({ ok: false, error: "role_archived" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a missing role as not_found, and a malformed role id the same way", async () => {
    const store = createFakeRoleStore();

    expect(await updateRole("token", "missing", { name: "Ny" }, deps({ store }))).toEqual({ ok: false, error: "not_found" });
    expect(await updateRole("token", "bad/id", { name: "Ny" }, deps({ store }))).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a non-admin before reading the role", async () => {
    const store = createFakeRoleStore();
    const roleId = await seedRole(store);
    const spy = vi.spyOn(store, "get");

    const result = await updateRole("token", roleId, { name: "Ny" }, deps({ store, verifyToken: vi.fn().mockResolvedValue({ uid: "member-1", email: "m@example.com", email_verified: true }) }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(spy).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { listActiveRolesForPerson } from "./list-active-roles";
import { createFakeRoleStore } from "./fake-role-store";
import type { RoleStore } from "./role-store-types";

const T0 = new Date("2026-06-01T00:00:00.000Z");

describe("listActiveRolesForPerson", () => {
  it("returns only the title and description of each active role", async () => {
    const store = createFakeRoleStore();
    await store.create({ name: "Utvikler", description: "Bygger tjenester", createdAt: T0, createdBy: "admin-1" });
    await store.create({ name: "Designer", description: "Designer produkter", createdAt: T0, createdBy: "admin-1" });

    const result = await listActiveRolesForPerson({ store });

    expect(result).toEqual({
      ok: true,
      roles: [
        { roleId: "fake-role-1", name: "Utvikler", description: "Bygger tjenester" },
        { roleId: "fake-role-2", name: "Designer", description: "Designer produkter" },
      ],
      truncated: false,
    });
  });

  it("excludes archived roles", async () => {
    const store = createFakeRoleStore();
    await store.create({ name: "Utgått", createdAt: T0, createdBy: "admin-1", description: "Beskrivelse", archivedAt: T0, archivedBy: "admin-1" });
    await store.create({ name: "Aktiv", createdAt: T0, createdBy: "admin-1", description: "Beskrivelse" });

    const result = await listActiveRolesForPerson({ store });

    expect(result.ok && result.roles.map((role) => role.name)).toEqual(["Aktiv"]);
  });

  it("excludes a malformed stored document without exposing its content", async () => {
    const store = createFakeRoleStore();
    store.seedRaw("broken", { name: "Skjult", createdAt: T0, createdBy: "admin-1", description: "Beskrivelse", expectations: [{ treeId: "x" }] });
    await store.create({ name: "Aktiv", createdAt: T0, createdBy: "admin-1", description: "Beskrivelse" });

    const result = await listActiveRolesForPerson({ store });

    expect(result.ok && result.roles.map((role) => role.name)).toEqual(["Aktiv"]);
    expect(JSON.stringify(result)).not.toContain("Skjult");
  });

  it("reports truncated when a 51st raw document exists", async () => {
    const store = createFakeRoleStore();
    for (let index = 0; index < 51; index += 1) {
      await store.create({ name: `Rolle ${index}`, createdAt: new Date(T0.getTime() + index), createdBy: "admin-1", description: "Beskrivelse" });
    }

    const result = await listActiveRolesForPerson({ store });

    expect(result.ok && result.truncated).toBe(true);
    expect(result.ok && result.roles).toHaveLength(50);
  });

  it("returns a neutral persistence failure and no content when the read fails", async () => {
    const failing: RoleStore = {
      ...createFakeRoleStore(),
      listWindow: async () => {
        throw new Error("boom: Rolle Utvikler");
      },
    };

    const result = await listActiveRolesForPerson({ store: failing });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });
});

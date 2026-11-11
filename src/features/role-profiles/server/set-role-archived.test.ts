import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { setRoleArchived, type SetRoleArchivedDeps } from "./set-role-archived";
import { createFakeRoleStore } from "./fake-role-store";

const ADMIN_UID = "admin-1";
const T0 = new Date("2026-06-01T00:00:00.000Z");
const T1 = new Date("2026-10-01T10:00:00.000Z");

function deps(overrides: Partial<SetRoleArchivedDeps> = {}): SetRoleArchivedDeps {
  return {
    verifyToken: vi.fn().mockResolvedValue({ uid: ADMIN_UID, email: "admin@example.com", email_verified: true }),
    isSuperadmin: async (uid: string) => uid === ADMIN_UID,
    readFence: async () => ({ kind: "none" }),
    store: createFakeRoleStore(),
    now: () => T1,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setRoleArchived", () => {
  it("archives an active role, recording who and when, and keeps its title and description", async () => {
    const store = createFakeRoleStore();
    const roleId = await store.create({ name: "Utvikler", description: "Bygger tjenester", createdAt: T0, createdBy: ADMIN_UID });

    const result = await setRoleArchived("token", roleId, true, deps({ store }));

    expect(result).toEqual({
      ok: true,
      role: { roleId, name: "Utvikler", description: "Bygger tjenester", archived: true, createdAt: T0 },
    });
    expect(await store.get(roleId)).toMatchObject({ archivedAt: T1, archivedBy: ADMIN_UID, createdAt: T0 });
  });

  it("restores an archived role by removing the archive fields", async () => {
    const store = createFakeRoleStore();
    const roleId = await store.create({
      name: "Utvikler",
      description: "Bygger tjenester",
      createdAt: T0,
      createdBy: ADMIN_UID,
      archivedAt: T0,
      archivedBy: ADMIN_UID,
    });

    const result = await setRoleArchived("token", roleId, false, deps({ store }));

    expect(result.ok && result.role.archived).toBe(false);
    const raw = await store.get(roleId);
    expect(raw?.archivedAt).toBeUndefined();
    expect(raw?.archivedBy).toBeUndefined();
  });

  it("treats archiving an already archived role as an idempotent success that writes nothing", async () => {
    const store = createFakeRoleStore();
    const roleId = await store.create({ name: "Utvikler", description: "Bygger tjenester", createdAt: T0, createdBy: ADMIN_UID, archivedAt: T0, archivedBy: ADMIN_UID });
    const spy = vi.spyOn(store, "update");

    const result = await setRoleArchived("token", roleId, true, deps({ store }));

    expect(result.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a non-boolean archived value with invalid_input", async () => {
    const store = createFakeRoleStore();
    const roleId = await store.create({ name: "Utvikler", description: "Bygger tjenester", createdAt: T0, createdBy: ADMIN_UID });

    expect(await setRoleArchived("token", roleId, "yes", deps({ store }))).toEqual({ ok: false, error: "invalid_input" });
  });

  it("reports a missing role as not_found", async () => {
    expect(await setRoleArchived("token", "missing", true, deps())).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses a non-admin with forbidden and changes nothing", async () => {
    const store = createFakeRoleStore();
    const roleId = await store.create({ name: "Utvikler", description: "Bygger tjenester", createdAt: T0, createdBy: ADMIN_UID });
    const spy = vi.spyOn(store, "update");

    const result = await setRoleArchived("token", roleId, true, deps({ store, verifyToken: vi.fn().mockResolvedValue({ uid: "member-1", email: "m@example.com", email_verified: true }) }));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(spy).not.toHaveBeenCalled();
  });
});

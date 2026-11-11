import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createRole, type CreateRoleDeps } from "./create-role";
import { createFakeRoleStore } from "./fake-role-store";

const ADMIN_UID = "admin-1";
const NOW = new Date("2026-10-01T10:00:00Z");

function verifyAs(uid: string) {
  return vi.fn().mockResolvedValue({ uid, email: "admin@example.com", email_verified: true });
}

function deps(overrides: Partial<CreateRoleDeps> = {}): CreateRoleDeps {
  return {
    verifyToken: verifyAs(ADMIN_UID),
    isSuperadmin: async (uid: string) => uid === ADMIN_UID,
    readFence: async () => ({ kind: "none" }),
    store: createFakeRoleStore({ generateId: () => "role-1" }),
    now: () => NOW,
    ...overrides,
  };
}

const VALID_INPUT = { name: "  Backend-utvikler  ", description: "  Bygger og drifter tjenester.  " };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRole", () => {
  it("creates a role from a trimmed title and description, and returns the admin view", async () => {
    const store = createFakeRoleStore({ generateId: () => "role-1" });

    const result = await createRole("token", VALID_INPUT, deps({ store }));

    expect(result).toEqual({
      ok: true,
      role: {
        roleId: "role-1",
        name: "Backend-utvikler",
        description: "Bygger og drifter tjenester.",
        archived: false,
        createdAt: NOW,
      },
    });
  });

  it("refuses an unauthenticated caller and writes nothing", async () => {
    const store = createFakeRoleStore();
    const spy = vi.spyOn(store, "create");

    const result = await createRole("token", VALID_INPUT, {
      ...deps({ store }),
      verifyToken: vi.fn().mockRejectedValue(new Error("bad token")),
    });

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a signed-in person who is not an administrator and writes nothing", async () => {
    const store = createFakeRoleStore();
    const spy = vi.spyOn(store, "create");

    const result = await createRole("token", VALID_INPUT, {
      ...deps({ store }),
      verifyToken: verifyAs("member-1"),
    });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing title", { description: "Beskrivelse" }],
    ["an empty title after trimming", { name: "   ", description: "Beskrivelse" }],
    ["a title over 80 characters", { name: "x".repeat(81), description: "Beskrivelse" }],
    ["a missing description", { name: "Utvikler" }],
    ["an empty description after trimming", { name: "Utvikler", description: "   " }],
    ["a description over 500 characters", { name: "Utvikler", description: "x".repeat(501) }],
    ["an obsolete expectations field", { name: "Utvikler", description: "Beskrivelse", expectations: [] }],
    ["a non-string title", { name: 42, description: "Beskrivelse" }],
  ])("refuses %s with invalid_input and writes nothing", async (_label, input) => {
    const store = createFakeRoleStore();
    const spy = vi.spyOn(store, "create");

    const result = await createRole("token", input, deps({ store }));

    expect(result).toEqual({ ok: false, error: "invalid_input" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts a title of exactly 80 and a description of exactly 500 characters", async () => {
    const result = await createRole(
      "token",
      { name: "x".repeat(80), description: "y".repeat(500) },
      deps(),
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a create when the role cap is reached", async () => {
    const store = createFakeRoleStore();
    for (let index = 0; index < 50; index += 1) {
      await store.create({ name: `Rolle ${index}`, description: "Beskrivelse", createdAt: NOW, createdBy: ADMIN_UID });
    }

    const result = await createRole("token", VALID_INPUT, deps({ store }));

    expect(result).toEqual({ ok: false, error: "cap_reached" });
  });
});

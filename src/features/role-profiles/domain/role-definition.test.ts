import { describe, expect, it } from "vitest";
import {
  ROLE_DESCRIPTION_MAX,
  ROLE_NAME_MAX,
  parseStoredRoleDefinition,
  toRoleAdminDto,
  validateRoleDraft,
  validateRolePatch,
} from "./role-definition";

const createdAt = new Date("2026-01-01T10:00:00.000Z");

describe("role draft validation (title and description only)", () => {
  it("accepts a title with a description", () => {
    expect(validateRoleDraft({ name: "Senior utvikler", description: "Utvikler løsninger." })).toEqual({
      ok: true,
      draft: { name: "Senior utvikler", description: "Utvikler løsninger." },
    });
  });

  it("accepts a title without a description", () => {
    expect(validateRoleDraft({ name: "Senior utvikler" })).toEqual({ ok: true, draft: { name: "Senior utvikler" } });
  });

  it("rejects a missing or blank title", () => {
    expect(validateRoleDraft({ description: "Uten tittel." }).ok).toBe(false);
    expect(validateRoleDraft({ name: "   ", description: "Blank." }).ok).toBe(false);
  });

  it("rejects a title over 80 characters", () => {
    expect(validateRoleDraft({ name: "x".repeat(ROLE_NAME_MAX + 1) }).ok).toBe(false);
  });

  it("rejects a description over 500 characters", () => {
    expect(validateRoleDraft({ name: "Rolle", description: "x".repeat(ROLE_DESCRIPTION_MAX + 1) }).ok).toBe(false);
  });

  it("drops a blank description rather than storing an empty string", () => {
    expect(validateRoleDraft({ name: "Rolle", description: "   " })).toEqual({ ok: true, draft: { name: "Rolle" } });
  });

  it("rejects the obsolete expectations field and any other unknown key", () => {
    expect(validateRoleDraft({ name: "Rolle", expectations: [] }).ok).toBe(false);
    expect(validateRoleDraft({ name: "Rolle", createdBy: "someone" }).ok).toBe(false);
  });
});

describe("role patch validation", () => {
  it("rejects an empty patch", () => {
    expect(validateRolePatch({}).ok).toBe(false);
  });

  it("treats a blank description as a clear", () => {
    expect(validateRolePatch({ description: "  " })).toEqual({ ok: true, patch: { description: { clear: true } } });
  });

  it("rejects the obsolete expectations field", () => {
    expect(validateRolePatch({ expectations: [] }).ok).toBe(false);
  });
});

describe("stored role parsing", () => {
  const stored = { name: "Arkitekt", description: "Designer systemer.", createdAt, createdBy: "uid-admin" };

  it("parses a title-and-description document", () => {
    expect(parseStoredRoleDefinition(stored)).toEqual({
      ok: true,
      role: { name: "Arkitekt", description: "Designer systemer.", createdAt },
    });
  });

  it("fails closed on a legacy document that still has expectations", () => {
    expect(parseStoredRoleDefinition({ ...stored, expectations: [{ treeId: "t", expectedLevel: 3 }] }).ok).toBe(false);
  });

  it("does not copy audit fields into the domain role", () => {
    const parsed = parseStoredRoleDefinition(stored);
    expect(parsed.ok && "createdBy" in parsed.role).toBe(false);
  });
});

describe("admin DTO", () => {
  it("exposes only title, description, lifecycle and dates", () => {
    const dto = toRoleAdminDto({ roleId: "r1", name: "Arkitekt", archived: false, createdAt });
    expect(Object.keys(dto).sort()).toEqual(["archived", "createdAt", "name", "roleId"]);
  });
});

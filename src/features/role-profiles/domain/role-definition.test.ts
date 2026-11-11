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

describe("role draft validation (title and required description)", () => {
  it("accepts a title with a description", () => {
    expect(validateRoleDraft({ name: "Senior utvikler", description: "Utvikler løsninger." })).toEqual({
      ok: true,
      draft: { name: "Senior utvikler", description: "Utvikler løsninger." },
    });
  });

  it("rejects a missing description", () => {
    expect(validateRoleDraft({ name: "Senior utvikler" }).ok).toBe(false);
  });

  it("rejects a blank description rather than storing an empty string", () => {
    expect(validateRoleDraft({ name: "Rolle", description: "   " }).ok).toBe(false);
  });

  it("rejects a missing or blank title", () => {
    expect(validateRoleDraft({ description: "Uten tittel." }).ok).toBe(false);
    expect(validateRoleDraft({ name: "   ", description: "Blank." }).ok).toBe(false);
  });

  it("rejects a title over 80 characters", () => {
    expect(validateRoleDraft({ name: "x".repeat(ROLE_NAME_MAX + 1), description: "Beskrivelse" }).ok).toBe(false);
  });

  it("accepts a description of exactly 500 characters and rejects 501", () => {
    expect(validateRoleDraft({ name: "Rolle", description: "x".repeat(ROLE_DESCRIPTION_MAX) }).ok).toBe(true);
    expect(validateRoleDraft({ name: "Rolle", description: "x".repeat(ROLE_DESCRIPTION_MAX + 1) }).ok).toBe(false);
  });

  it("rejects the obsolete expectations field and any other unknown key", () => {
    expect(validateRoleDraft({ name: "Rolle", description: "Beskrivelse", expectations: [] }).ok).toBe(false);
    expect(validateRoleDraft({ name: "Rolle", description: "Beskrivelse", createdBy: "someone" }).ok).toBe(false);
  });
});

describe("role patch validation", () => {
  it("rejects an empty patch", () => {
    expect(validateRolePatch({}).ok).toBe(false);
  });

  it("refuses a blank description, which cannot clear a required field", () => {
    expect(validateRolePatch({ description: "  " }).ok).toBe(false);
  });

  it("accepts a title-only patch", () => {
    expect(validateRolePatch({ name: "Ny tittel" })).toEqual({ ok: true, patch: { name: "Ny tittel" } });
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

  it("fails closed on a document without a description", () => {
    const withoutDescription = { name: stored.name, createdAt: stored.createdAt, createdBy: stored.createdBy };
    expect(parseStoredRoleDefinition(withoutDescription).ok).toBe(false);
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
    const dto = toRoleAdminDto({ roleId: "r1", name: "Arkitekt", description: "Designer systemer.", archived: false, createdAt });
    expect(Object.keys(dto).sort()).toEqual(["archived", "createdAt", "description", "name", "roleId"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  parseStoredRoleDefinition,
  normalizeRoleDescription,
  normalizeRoleName,
  ROLE_DEFINITION_LIMIT,
  ROLE_DESCRIPTION_MAX,
  ROLE_EXPECTATIONS_MAX,
  ROLE_LIST_WINDOW,
  ROLE_NAME_MAX,
  ROLE_NAME_MIN,
  toRoleAdminDto,
  toRoleDto,
  validateRoleDraft,
  validateRoleExpectations,
} from "./role-definition";

const exp = (treeId: string, expectedLevel: number) => ({ treeId, expectedLevel });

const CREATED_AT = new Date("2026-10-01T10:00:00Z");

function storedRole(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Backend engineer",
    expectations: [exp("api-design", 3)],
    createdAt: CREATED_AT,
    createdBy: "admin-uid",
    ...overrides,
  };
}

describe("role limits", () => {
  it("exposes the approved constants", () => {
    expect(ROLE_DEFINITION_LIMIT).toBe(50);
    expect(ROLE_LIST_WINDOW).toBe(50);
    expect(ROLE_NAME_MIN).toBe(1);
    expect(ROLE_NAME_MAX).toBe(80);
    expect(ROLE_DESCRIPTION_MAX).toBe(500);
    expect(ROLE_EXPECTATIONS_MAX).toBe(20);
  });
});

describe("normalizeRoleName", () => {
  it.each([
    ["  Backend  ", "Backend"],
    ["a", "a"],
    ["x".repeat(80), "x".repeat(80)],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeRoleName(input)).toEqual({ ok: true, name: expected });
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["81 characters", "x".repeat(81)],
    ["non-string", 42],
    ["undefined", undefined],
  ])("rejects %s", (_label, input) => {
    expect(normalizeRoleName(input)).toEqual({ ok: false });
  });

  it("counts code points, not UTF-16 units", () => {
    const fortyEmoji = "😀".repeat(80);
    expect(normalizeRoleName(fortyEmoji)).toEqual({ ok: true, name: fortyEmoji });
    expect(normalizeRoleName("😀".repeat(81))).toEqual({ ok: false });
  });
});

describe("normalizeRoleDescription", () => {
  it("treats an absent value as absent", () => {
    expect(normalizeRoleDescription(undefined)).toEqual({ ok: true });
  });

  it("treats a whitespace-only value as absent", () => {
    const result = normalizeRoleDescription("   \n\t ");
    expect(result).toEqual({ ok: true });
    expect(result).not.toHaveProperty("description");
  });

  it("trims a present description", () => {
    expect(normalizeRoleDescription("  Owns APIs  ")).toEqual({ ok: true, description: "Owns APIs" });
  });

  it("accepts exactly 500 code points after trim", () => {
    const text = "x".repeat(500);
    expect(normalizeRoleDescription(`  ${text}  `)).toEqual({ ok: true, description: text });
  });

  it("rejects 501 code points after trim", () => {
    expect(normalizeRoleDescription("x".repeat(501))).toEqual({ ok: false });
  });

  it("counts code points, not UTF-16 units", () => {
    expect(normalizeRoleDescription("😀".repeat(500))).toEqual({ ok: true, description: "😀".repeat(500) });
    expect(normalizeRoleDescription("😀".repeat(501))).toEqual({ ok: false });
  });

  it("rejects a non-string value", () => {
    expect(normalizeRoleDescription(null)).toEqual({ ok: false });
    expect(normalizeRoleDescription(7)).toEqual({ ok: false });
  });
});

describe("validateRoleExpectations", () => {
  it.each([2, 3, 4])("accepts level %i", (level) => {
    expect(validateRoleExpectations([exp("t", level)])).toEqual({ ok: true, expectations: [{ treeId: "t", expectedLevel: level }] });
  });

  it.each([0, 1, 5, 2.5, "3", null])("rejects level %j", (level) => {
    expect(validateRoleExpectations([exp("t", level as number)])).toEqual({ ok: false });
  });

  it("accepts a role with zero expectations", () => {
    expect(validateRoleExpectations([])).toEqual({ ok: true, expectations: [] });
  });

  it("accepts exactly 20 expectations", () => {
    const twenty = Array.from({ length: 20 }, (_, index) => exp(`tree-${index}`, 2));
    const result = validateRoleExpectations(twenty);
    expect(result.ok && result.expectations).toHaveLength(20);
  });

  it("rejects 21 expectations", () => {
    const twentyOne = Array.from({ length: 21 }, (_, index) => exp(`tree-${index}`, 2));
    expect(validateRoleExpectations(twentyOne)).toEqual({ ok: false });
  });

  it("rejects a duplicate treeId", () => {
    expect(validateRoleExpectations([exp("t", 2), exp("t", 4)])).toEqual({ ok: false });
  });

  it("rejects a malformed treeId", () => {
    expect(validateRoleExpectations([exp("", 2)])).toEqual({ ok: false });
    expect(validateRoleExpectations([exp("has space", 2)])).toEqual({ ok: false });
  });

  it("rejects an extra key on an expectation", () => {
    expect(validateRoleExpectations([{ treeId: "t", expectedLevel: 2, required: true }])).toEqual({ ok: false });
  });

  it("rejects a non-array value", () => {
    expect(validateRoleExpectations(undefined)).toEqual({ ok: false });
    expect(validateRoleExpectations({})).toEqual({ ok: false });
  });
});

describe("parseStoredRoleDefinition", () => {
  it("parses a valid stored document into domain content without audit fields", () => {
    const result = parseStoredRoleDefinition(
      storedRole({ description: "Owns APIs", updatedAt: new Date("2026-10-02T10:00:00Z"), updatedBy: "admin-2" }),
    );
    expect(result).toEqual({
      ok: true,
      role: {
        name: "Backend engineer",
        description: "Owns APIs",
        expectations: [{ treeId: "api-design", expectedLevel: 3 }],
        createdAt: CREATED_AT,
        updatedAt: new Date("2026-10-02T10:00:00Z"),
      },
    });
    expect(result.ok && Object.keys(result.role)).not.toContain("createdBy");
  });

  it("returns an archived role with archivedAt", () => {
    const archivedAt = new Date("2026-10-05T10:00:00Z");
    const result = parseStoredRoleDefinition(storedRole({ archivedAt, archivedBy: "admin-uid" }));
    expect(result.ok && result.role.archivedAt).toEqual(archivedAt);
  });

  it.each([
    ["non-object", "role"],
    ["array", []],
    ["null", null],
    ["unknown key", { ...storedRole(), extra: 1 }],
    ["missing name", storedRole({ name: undefined })],
    ["non-string name", storedRole({ name: 12 })],
    ["unnormalised name", storedRole({ name: " Backend " })],
    ["empty stored description", storedRole({ description: "" })],
    ["unnormalised description", storedRole({ description: " text " })],
    ["out-of-range level", storedRole({ expectations: [exp("t", 5)] })],
    ["duplicate treeId", storedRole({ expectations: [exp("t", 2), exp("t", 3)] })],
    ["missing expectations", storedRole({ expectations: undefined })],
    ["missing createdAt", storedRole({ createdAt: undefined })],
    ["invalid createdAt", storedRole({ createdAt: "2026-10-01" })],
    ["missing createdBy", storedRole({ createdBy: undefined })],
    ["updatedAt before createdAt", storedRole({ updatedAt: new Date("2026-09-01T00:00:00Z") })],
  ])("reports %s as invalid without throwing", (_label, data) => {
    expect(parseStoredRoleDefinition(data)).toEqual({ ok: false });
  });
});

describe("toRoleDto", () => {
  it("copies only the allow-listed fields", () => {
    const source = {
      roleId: "role-1",
      name: "Backend engineer",
      description: "Owns APIs",
      selectable: true,
      expectations: [{ treeId: "api-design", treeName: "API design", expectedLevel: 3 as const }],
      createdBy: "admin-uid",
      updatedBy: "admin-2",
      archivedBy: "admin-3",
      uid: "person-uid",
    };
    const dto = toRoleDto(source);
    expect(dto).toStrictEqual({
      roleId: "role-1",
      name: "Backend engineer",
      description: "Owns APIs",
      selectable: true,
      expectations: [{ treeId: "api-design", treeName: "API design", expectedLevel: 3 }],
    });
  });

  it("omits description when absent rather than setting it to undefined", () => {
    const dto = toRoleDto({ roleId: "role-1", name: "Draft", selectable: false, expectations: [] });
    expect(dto).toStrictEqual({ roleId: "role-1", name: "Draft", selectable: false, expectations: [] });
    expect(dto).not.toHaveProperty("description");
  });

  it("keeps a null treeName for an unavailable SkillTree", () => {
    const dto = toRoleDto({
      roleId: "role-1",
      name: "Draft",
      selectable: false,
      expectations: [{ treeId: "gone", treeName: null, expectedLevel: 2 }],
    });
    expect(dto.expectations).toEqual([{ treeId: "gone", treeName: null, expectedLevel: 2 }]);
  });
});

describe("validateRoleDraft", () => {
  it("accepts a draft with a name, expectations and an optional description", () => {
    expect(validateRoleDraft({ name: " Lead ", description: " Owns teams ", expectations: [exp("t", 2)] })).toEqual({
      ok: true,
      draft: { name: "Lead", description: "Owns teams", expectations: [{ treeId: "t", expectedLevel: 2 }] },
    });
  });

  it("omits an absent or blank description", () => {
    const result = validateRoleDraft({ name: "Lead", description: "   ", expectations: [] });
    expect(result.ok && result.draft).toStrictEqual({ name: "Lead", expectations: [] });
  });

  it.each([
    ["missing expectations", { name: "Lead" }],
    ["missing name", { expectations: [] }],
    ["an unknown key such as createdBy", { name: "Lead", expectations: [], createdBy: "x" }],
    ["a non-object body", "Lead"],
  ])("rejects %s", (_label, input) => {
    expect(validateRoleDraft(input)).toEqual({ ok: false });
  });
});

describe("toRoleAdminDto", () => {
  it("copies named fields only and omits absent optionals", () => {
    const dto = toRoleAdminDto({
      roleId: "role-1",
      name: "Draft",
      expectations: [],
      archived: false,
      createdAt: CREATED_AT,
      ...({ createdBy: "admin-uid", updatedBy: "admin-2", archivedBy: "admin-3", uid: "person" } as object),
    });
    expect(dto).toStrictEqual({ roleId: "role-1", name: "Draft", expectations: [], archived: false, createdAt: CREATED_AT });
  });

  it("includes description and updatedAt when present", () => {
    const updatedAt = new Date("2026-10-02T10:00:00Z");
    const dto = toRoleAdminDto({
      roleId: "role-1",
      name: "Lead",
      description: "Owns teams",
      expectations: [],
      archived: true,
      createdAt: CREATED_AT,
      updatedAt,
    });
    expect(dto).toMatchObject({ description: "Owns teams", archived: true, updatedAt });
  });
});

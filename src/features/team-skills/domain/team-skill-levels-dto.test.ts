import { describe, expect, it } from "vitest";
import { parseTeamSkillLevelsDto, toTeamSkillLevelsDto, toTeamSkillLevelDto, type TeamSkillLevelInput } from "./team-skill-levels-dto";

/** Synthetic fixtures only. Extra keys model a leak the allow-list must never pass through. */
const value = (overrides: Record<string, unknown> = {}) =>
  ({ treeId: "tree-1", areaName: "Område 1", targetLevel: 3, state: "value", level: 2, ...overrides }) as unknown as TeamSkillLevelInput;

describe("toTeamSkillLevelDto: allow-list", () => {
  it("drops identities, counts, sums and requiredCoverage from the input row", () => {
    const leaked = value({ uid: "uid-x", contributorCount: 5, sum: 14, requiredCoverage: 2, memberRef: "m-1" });
    const dto = toTeamSkillLevelDto(leaked);
    expect(Object.keys(dto).sort()).toEqual(["areaName", "level", "state", "targetLevel", "treeId"]);
    expect(JSON.stringify(dto)).not.toMatch(/uid-x|contributorCount|requiredCoverage|memberRef|"sum"/);
  });

  it("gives an insufficient_data row no level key at all, not a null or zero level", () => {
    const dto = toTeamSkillLevelDto({ treeId: "tree-2", areaName: "Område 2", targetLevel: 4, state: "insufficient_data" });
    expect(Object.keys(dto)).not.toContain("level");
    expect(dto).toEqual({ treeId: "tree-2", areaName: "Område 2", targetLevel: 4, state: "insufficient_data" });
  });

  it("returns areaName null for an area_unavailable row, and no level", () => {
    const dto = toTeamSkillLevelDto({ treeId: "tree-3", areaName: null, targetLevel: 2, state: "area_unavailable" });
    expect(dto).toEqual({ treeId: "tree-3", areaName: null, targetLevel: 2, state: "area_unavailable" });
  });
});

describe("toTeamSkillLevelsDto", () => {
  it("returns no rows for an incomplete scan", () => {
    expect(toTeamSkillLevelsDto({ availability: "incomplete" })).toEqual({ availability: "incomplete", rows: [] });
  });

  it("maps every row of an available response through the allow-list", () => {
    const dto = toTeamSkillLevelsDto({ availability: "available", rows: [value({ uid: "leak" })] });
    expect(dto.rows).toHaveLength(1);
    expect(JSON.stringify(dto)).not.toContain("leak");
  });
});

describe("parseTeamSkillLevelsDto: fail-closed client parsing", () => {
  const valid = {
    availability: "available",
    rows: [
      { treeId: "t1", areaName: "Alpha", targetLevel: 3, state: "value", level: 2 },
      { treeId: "t2", areaName: "Beta", targetLevel: 2, state: "insufficient_data" },
      { treeId: "t3", areaName: null, targetLevel: 4, state: "area_unavailable" },
    ],
  };

  it("parses a valid body and round-trips the server DTO", () => {
    expect(parseTeamSkillLevelsDto(valid)).toEqual(valid);
    const built = toTeamSkillLevelsDto({
      availability: "available",
      rows: [{ treeId: "t1", areaName: "Alpha", targetLevel: 3, state: "value", level: 2 }],
    });
    expect(parseTeamSkillLevelsDto(JSON.parse(JSON.stringify(built)))).toEqual(built);
  });

  it("drops an unexpected key from a row rather than passing it on", () => {
    const parsed = parseTeamSkillLevelsDto({ availability: "available", rows: [{ ...valid.rows[0], uid: "leak" }] });
    expect(parsed?.rows[0]).not.toHaveProperty("uid");
  });

  it.each([
    ["a level of 0", { ...valid.rows[0], level: 0 }],
    ["a level of 5", { ...valid.rows[0], level: 5 }],
    ["a fractional level", { ...valid.rows[0], level: 2.5 }],
    ["a string level", { ...valid.rows[0], level: "2" }],
    ["a missing level on a value row", { treeId: "t1", areaName: "Alpha", targetLevel: 3, state: "value" }],
    ["a target of 1", { ...valid.rows[0], targetLevel: 1 }],
    ["an unknown state", { ...valid.rows[0], state: "suppressed" }],
    ["a named area_unavailable row", { treeId: "t3", areaName: "Gamma", targetLevel: 4, state: "area_unavailable" }],
    ["an empty area name", { ...valid.rows[0], areaName: "" }],
  ])("rejects a body containing %s", (_label, row) => {
    expect(parseTeamSkillLevelsDto({ availability: "available", rows: [row] })).toBeUndefined();
  });

  it("rejects rows for an incomplete availability", () => {
    expect(parseTeamSkillLevelsDto({ availability: "incomplete", rows: valid.rows })).toBeUndefined();
    expect(parseTeamSkillLevelsDto({ availability: "incomplete", rows: [] })).toEqual({ availability: "incomplete", rows: [] });
  });

  it.each([null, "body", [], { availability: "available" }, { availability: "available", rows: "x" }, { availability: "other", rows: [] }])(
    "rejects a non-DTO body %j",
    (body) => {
      expect(parseTeamSkillLevelsDto(body)).toBeUndefined();
    },
  );
});

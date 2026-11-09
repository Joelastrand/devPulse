import { describe, expect, it } from "vitest";
import { buildRadarModel } from "./radar-model";
import { UNAVAILABLE_AREA_LABEL, buildAutomaticAxes, type AutomaticSkillLevelRow } from "./automatic-profile";

/** Synthetic fixtures only. */
const value = (n: number, level: number, targetLevel: number | null = 3): AutomaticSkillLevelRow => ({
  treeId: `tree-${n}`,
  areaName: `Område ${n}`,
  targetLevel,
  state: "value",
  level,
});
const insufficient = (n: number, targetLevel: number | null = 3): AutomaticSkillLevelRow => ({
  treeId: `tree-${n}`,
  areaName: `Område ${n}`,
  targetLevel,
  state: "insufficient_data",
});
const unavailable = (n: number, targetLevel: number | null = 3): AutomaticSkillLevelRow => ({
  treeId: `tree-${n}`,
  areaName: null,
  targetLevel,
  state: "area_unavailable",
});

/** `count` rows with a level, followed by the given missing rows, all in order. */
const rowsWith = (count: number, level = 2): AutomaticSkillLevelRow[] =>
  Array.from({ length: count }, (_, i) => value(i + 1, level));

describe("buildAutomaticAxes: mapping", () => {
  it("maps a value row to its integer team level and target, keeping the area name as the label", () => {
    expect(buildAutomaticAxes([value(1, 4, 2)])).toEqual([
      { treeId: "tree-1", label: "Område 1", teamLevel: 4, targetLevel: 2 },
    ]);
  });

  it("keeps a missing team level as null, never zero, for insufficient_data", () => {
    const [axis] = buildAutomaticAxes([insufficient(1)]);
    expect(axis.teamLevel).toBeNull();
    expect(axis.teamLevel).not.toBe(0);
  });

  it("keeps a missing target as null", () => {
    const [axis] = buildAutomaticAxes([value(1, 2, null)]);
    expect(axis.targetLevel).toBeNull();
  });

  it("labels an unavailable area with the Norwegian placeholder and no team level", () => {
    expect(buildAutomaticAxes([unavailable(9)])).toEqual([
      { treeId: "tree-9", label: UNAVAILABLE_AREA_LABEL, teamLevel: null, targetLevel: 3 },
    ]);
    expect(UNAVAILABLE_AREA_LABEL).toBe("Område ikke tilgjengelig");
  });

  it("emits only the four radar fields: no counts, identities or assessments", () => {
    for (const axis of buildAutomaticAxes([value(1, 3), insufficient(2), unavailable(3)])) {
      expect(Object.keys(axis).sort()).toEqual(["label", "targetLevel", "teamLevel", "treeId"]);
    }
  });

  it("keeps the order of the rows it was given", () => {
    const axes = buildAutomaticAxes([value(2, 2), insufficient(1), unavailable(3)]);
    expect(axes.map((axis) => axis.treeId)).toEqual(["tree-2", "tree-1", "tree-3"]);
  });

  it("does not coerce a non-integer or out-of-range level: the radar model reports invalid", () => {
    const axes = buildAutomaticAxes([value(1, 2), value(2, 5), value(3, 2)]);
    expect(buildRadarModel(axes).status).toBe("invalid");
    expect(buildRadarModel(buildAutomaticAxes([value(1, 0), value(2, 2), value(3, 2)])).status).toBe("invalid");
    expect(buildRadarModel(buildAutomaticAxes([value(1, 2.5), value(2, 2), value(3, 2)])).status).toBe("invalid");
  });
});

/** Malformed rows are outside the typed contract, so they are built with an explicit cast. Synthetic values only. */
const malformed = (row: Record<string, unknown>): AutomaticSkillLevelRow => row as unknown as AutomaticSkillLevelRow;

/** Three valid rows plus one malformed row: the radar must report invalid for the whole profile. */
const withMalformed = (row: AutomaticSkillLevelRow) =>
  buildRadarModel(buildAutomaticAxes([value(1, 2), value(2, 3), value(3, 4), row]));

describe("buildAutomaticAxes: malformed rows are rejected, never treated as missing", () => {
  it.each([
    ["a fractional level", 2.5],
    ["a level above 4", 5],
    ["a level of 0", 0],
    ["a negative level", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string", "2"],
    ["an absent level", undefined],
    ["a null level on a value row", null],
  ])("reports invalid for a value row with %s", (_label, level) => {
    expect(withMalformed(malformed({ treeId: "tree-x", areaName: "Område x", targetLevel: 3, state: "value", level })).status).toBe(
      "invalid",
    );
  });

  it("reports invalid for a value row with no area name, instead of the unavailable placeholder", () => {
    const row = malformed({ treeId: "tree-x", areaName: null, targetLevel: 3, state: "value", level: 2 });
    expect(withMalformed(row).status).toBe("invalid");
    expect(buildAutomaticAxes([row])[0].label).not.toBe(UNAVAILABLE_AREA_LABEL);
  });

  it("reports invalid for an insufficient_data row with no area name", () => {
    const row = malformed({ treeId: "tree-x", areaName: null, targetLevel: 3, state: "insufficient_data" });
    expect(withMalformed(row).status).toBe("invalid");
  });

  it("reports invalid for a row with an unknown state, and does not read it as unavailable", () => {
    const row = malformed({ treeId: "tree-x", areaName: "Område x", targetLevel: 3, state: "suppressed" });
    expect(withMalformed(row).status).toBe("invalid");
  });

  it.each([
    ["an absent target", undefined],
    ["a target of 1", 1],
    ["a target of 5", 5],
    ["a fractional target", 2.5],
    ["a numeric string target", "3"],
  ])("reports invalid for a value row with %s", (_label, targetLevel) => {
    expect(withMalformed(malformed({ treeId: "tree-x", areaName: "Område x", targetLevel, state: "value", level: 2 })).status).toBe(
      "invalid",
    );
  });

  it("still accepts a null target and a null level for the legitimate unavailable states", () => {
    expect(withMalformed(insufficient(4, null)).status).toBe("ready");
    expect(withMalformed(unavailable(4, null)).status).toBe("ready");
    expect(withMalformed(value(4, 2, null)).status).toBe("ready");
  });
});

describe("buildAutomaticAxes with the radar axis limits", () => {
  it.each([3, 4, 5, 8])("builds a ready radar for %i axes with missing values as null points", (count) => {
    const rows = [...rowsWith(count - 2), insufficient(count - 1), unavailable(count)];
    const model = buildRadarModel(buildAutomaticAxes(rows));
    expect(model.status).toBe("ready");
    if (model.status !== "ready") return;
    expect(model.points).toHaveLength(count);
    expect(model.points[count - 2]).toEqual({ axis: `Område ${count - 1}`, team: null, target: 3 });
    expect(model.points[count - 1]).toEqual({ axis: UNAVAILABLE_AREA_LABEL, team: null, target: 3 });
    expect(model.setCount).toBe(count - 2);
  });

  it("reports too_few_axes for two axes and too_many_axes for nine, without changing the mapping", () => {
    expect(buildRadarModel(buildAutomaticAxes(rowsWith(2))).status).toBe("too_few_axes");
    expect(buildRadarModel(buildAutomaticAxes(rowsWith(9))).status).toBe("too_many_axes");
  });

  it("reports empty when every row is missing a team level and a target", () => {
    const rows = [insufficient(1, null), insufficient(2, null), unavailable(3, null)];
    expect(buildRadarModel(buildAutomaticAxes(rows)).status).toBe("empty");
  });
});

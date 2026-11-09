import { describe, expect, it } from "vitest";
import { RADAR_MAX_AXES, RADAR_MIN_AXES, buildRadarModel, type RadarAxisInput } from "./radar-model";

/** Synthetic fixtures only. */
const axis = (n: number, teamLevel: number | null, targetLevel: number | null = 3): RadarAxisInput => ({
  treeId: `tree-${n}`,
  label: `Område ${n}`,
  teamLevel,
  targetLevel,
});
const axes = (count: number, teamLevel: number | null = 2) => Array.from({ length: count }, (_, i) => axis(i + 1, teamLevel));

describe("radar axis limits", () => {
  it("exposes the owner's limits: three to eight axes", () => {
    expect(RADAR_MIN_AXES).toBe(3);
    expect(RADAR_MAX_AXES).toBe(8);
  });
});

describe("radar rendering with 3, 4 and 5 axes", () => {
  it.each([3, 4, 5])("builds a ready chart for %i axes with one point per axis", (count) => {
    const model = buildRadarModel(axes(count));
    expect(model.status).toBe("ready");
    if (model.status !== "ready") return;
    expect(model.points).toHaveLength(count);
    expect(model.points[0]).toEqual({ axis: "Område 1", team: 2, target: 3 });
    expect(model.setCount).toBe(count);
  });

  it("keeps the order of the axes it was given", () => {
    const model = buildRadarModel([axis(3, 1), axis(1, 2), axis(2, 4)]);
    expect(model.status).toBe("ready");
    if (model.status !== "ready") return;
    expect(model.points.map((point) => point.axis)).toEqual(["Område 3", "Område 1", "Område 2"]);
  });
});

describe("missing and partial values", () => {
  it("never converts an unset team value to zero", () => {
    const model = buildRadarModel([axis(1, null), axis(2, 3), axis(3, 4)]);
    expect(model.status).toBe("ready");
    if (model.status !== "ready") return;
    expect(model.points.map((point) => point.team)).toEqual([null, 3, 4]);
    expect(model.setCount).toBe(2);
  });

  it("keeps a target-only axis without inventing a team value", () => {
    const model = buildRadarModel([axis(1, null, 4), axis(2, null, null), axis(3, 2, null)]);
    expect(model.status).toBe("ready");
    if (model.status !== "ready") return;
    expect(model.points[0]).toEqual({ axis: "Område 1", team: null, target: 4 });
    expect(model.points[1]).toEqual({ axis: "Område 2", team: null, target: null });
  });

  it("reports empty when no axis has a team value or a target", () => {
    expect(buildRadarModel([axis(1, null, null), axis(2, null, null), axis(3, null, null)]).status).toBe("empty");
  });
});

describe("axis limits and messages", () => {
  it("reports too few axes without building a chart", () => {
    const model = buildRadarModel(axes(2));
    expect(model.status).toBe("too_few_axes");
    expect("points" in model).toBe(false);
  });

  it("reports too many axes, which the UI shows as the table only", () => {
    expect(buildRadarModel(axes(9)).status).toBe("too_many_axes");
  });

  it("accepts exactly eight axes", () => {
    expect(buildRadarModel(axes(8)).status).toBe("ready");
  });
});

describe("invalid input fails closed", () => {
  it.each([
    ["a team level of zero", [axis(1, 0), axis(2, 2), axis(3, 2)]],
    ["a team level above four", [axis(1, 5), axis(2, 2), axis(3, 2)]],
    ["a fractional team level", [axis(1, 2.5), axis(2, 2), axis(3, 2)]],
    ["a numeric string as level", [axis(1, "3" as unknown as number), axis(2, 2), axis(3, 2)]],
    ["NaN as level", [axis(1, Number.NaN), axis(2, 2), axis(3, 2)]],
    ["a target of one (level 1 is never a need)", [axis(1, 2, 1), axis(2, 2), axis(3, 2)]],
    ["a duplicate tree id", [axis(1, 2), { ...axis(2, 2), treeId: "tree-1" }, axis(3, 2)]],
    ["an empty label", [{ ...axis(1, 2), label: "   " }, axis(2, 2), axis(3, 2)]],
    ["a label over 120 characters", [{ ...axis(1, 2), label: "x".repeat(121) }, axis(2, 2), axis(3, 2)]],
  ])("refuses %s", (_label, input) => {
    expect(buildRadarModel(input as RadarAxisInput[]).status).toBe("invalid");
  });

  it("refuses a non-array input", () => {
    expect(buildRadarModel(null as unknown as RadarAxisInput[]).status).toBe("invalid");
  });
});

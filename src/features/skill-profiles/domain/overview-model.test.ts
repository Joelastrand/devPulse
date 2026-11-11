import { describe, expect, it } from "vitest";
import { buildOverviewModel, type OverviewComparisonInput } from "./overview-model";
import { buildPersonalRadarModel, PERSONAL_RADAR_MAX_AXES } from "./personal-radar";
import type { SkillRowDto } from "./skill-profile-view";

/** Synthetic fixtures only. */
const skill = (treeId: string, level: SkillRowDto["level"]): SkillRowDto => ({ treeId, name: `Ferdighet ${treeId}`, level });

const skills: SkillRowDto[] = [skill("a", 4), skill("b", 3), skill("c", 2), skill("d", null), skill("e", 1)];

const target: OverviewComparisonInput = {
  targetName: "Testrolle",
  rows: [
    { treeId: "a", treeName: "Ferdighet a", expectedLevel: 3, status: "meets", ownLevel: 4 },
    { treeId: "b", treeName: "Ferdighet b", expectedLevel: 4, status: "development_opportunity", ownLevel: 3 },
    { treeId: "c", treeName: "Ferdighet c", expectedLevel: 3, status: "development_opportunity", ownLevel: 2 },
    { treeId: "d", treeName: "Ferdighet d", expectedLevel: 2, status: "not_assessed", ownLevel: null },
  ],
};

describe("buildOverviewModel summary counts (C1 BR-26, no mean or score)", () => {
  it("counts assessed skills at level 3 or higher as a count, not an average", () => {
    const model = buildOverviewModel(skills, null);
    expect(model.summary.atLeastIndependent).toBe(2);
    expect(model.summary.assessedCount).toBe(4);
    expect(model.summary.totalCount).toBe(5);
  });

  it("counts development areas as assessed skills at level 1 or 2", () => {
    const model = buildOverviewModel(skills, null);
    expect(model.summary.developmentAreaCount).toBe(2);
  });

  it("treats every skill as unassessed when none is assessed, without inventing values", () => {
    const model = buildOverviewModel([skill("x", null), skill("y", null)], null);
    expect(model.summary).toEqual({ atLeastIndependent: 0, assessedCount: 0, totalCount: 2, developmentAreaCount: 0 });
    expect(model.areas.every((area) => area.level === null)).toBe(true);
  });
});

describe("buildOverviewModel with a selected target role", () => {
  it("counts the target's meets and development rows and uses only development rows as suggestions", () => {
    const model = buildOverviewModel(skills, target);
    expect(model.target).toEqual({ name: "Testrolle", expectationCount: 4, meetsCount: 1, developmentCount: 2 });
    expect(model.suggestions.map((suggestion) => suggestion.treeId)).toEqual(["b", "c"]);
    expect(model.developmentTotal).toBe(2);
  });

  it("gives each area its status and expected level, and leaves areas outside the target without a status", () => {
    const model = buildOverviewModel(skills, target);
    const byId = Object.fromEntries(model.areas.map((area) => [area.treeId, area]));
    expect(byId.a).toMatchObject({ status: "meets", expectedLevel: 3 });
    expect(byId.e).toMatchObject({ status: null, expectedLevel: null });
  });

  it("keeps the canonical list order and every visible skill", () => {
    const model = buildOverviewModel(skills, target);
    expect(model.areas.map((area) => area.treeId)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("buildPersonalRadarModel (personal, own assessments only)", () => {
  it("shows no radar with fewer than three assessed skills, instead of drawing unassessed values as zero", () => {
    const areas = buildOverviewModel([skill("a", 4), skill("b", null), skill("c", null)], null).areas;
    expect(buildPersonalRadarModel(areas, false)).toEqual({ status: "too_few_assessed", assessedCount: 1 });
  });

  it("draws only assessed skills as axes, in canonical order", () => {
    const areas = buildOverviewModel(skills, null).areas;
    const radar = buildPersonalRadarModel(areas, false);
    expect(radar.status).toBe("ready");
    if (radar.status !== "ready") return;
    expect(radar.points.map((point) => point.treeId)).toEqual(["a", "b", "c", "e"]);
    expect(radar.points.every((point) => point.target === null)).toBe(true);
    expect(radar.showTarget).toBe(false);
  });

  it("draws the target series only when every drawn axis has an expectation", () => {
    const areas = buildOverviewModel(skills, { ...target, rows: target.rows.filter((row) => row.treeId !== "e") }).areas;
    const radar = buildPersonalRadarModel(areas, true);
    expect(radar.status === "ready" && radar.showTarget).toBe(false);
    if (radar.status === "ready") expect(radar.points.every((point) => point.target === null)).toBe(true);
  });

  it("draws the target series as a complete polygon when every drawn axis has an expectation", () => {
    const areas = buildOverviewModel(skills.filter((row) => row.treeId !== "e"), target).areas;
    const radar = buildPersonalRadarModel(areas, true);
    expect(radar.status).toBe("ready");
    if (radar.status !== "ready") return;
    expect(radar.showTarget).toBe(true);
    expect(radar.points.map((point) => point.target)).toEqual([3, 4, 3]);
  });

  it("caps the chart at the maximum axis count and reports the omitted assessed skills", () => {
    const many = Array.from({ length: PERSONAL_RADAR_MAX_AXES + 2 }, (_, index) => skill(`s${index}`, 2));
    const radar = buildPersonalRadarModel(buildOverviewModel(many, null).areas, false);
    expect(radar.status).toBe("ready");
    if (radar.status !== "ready") return;
    expect(radar.points).toHaveLength(PERSONAL_RADAR_MAX_AXES);
    expect(radar.omittedCount).toBe(2);
  });
});

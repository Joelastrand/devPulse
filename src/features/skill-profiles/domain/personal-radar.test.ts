import { describe, expect, it } from "vitest";
import { PERSONAL_RADAR_MAX_AXES, buildPersonalRadarModel } from "./personal-radar";
import type { OverviewAreaRow } from "./overview-model";

/** Synthetic fixtures only. */
const area = (index: number, level: OverviewAreaRow["level"]): OverviewAreaRow => ({
  treeId: `skill-${index}`,
  name: `Ferdighet ${index}`,
  level,
});

describe("personal radar model (own assessed levels only)", () => {
  it("plots only assessed skills, in list order, and counts the unassessed ones without drawing them", () => {
    const model = buildPersonalRadarModel([area(1, 4), area(2, null), area(3, 2), area(4, 3)]);
    expect(model).toEqual({
      status: "ready",
      points: [
        { treeId: "skill-1", label: "Ferdighet 1", own: 4 },
        { treeId: "skill-3", label: "Ferdighet 3", own: 2 },
        { treeId: "skill-4", label: "Ferdighet 4", own: 3 },
      ],
      omittedByCap: 0,
      unassessedCount: 1,
    });
  });

  it("draws no chart with fewer than three assessed skills, and never treats unassessed as zero", () => {
    expect(buildPersonalRadarModel([area(1, 4), area(2, null), area(3, null)])).toEqual({
      status: "too_few",
      assessedCount: 1,
      unassessedCount: 2,
    });
  });

  it("draws at most twelve axes and reports how many assessed skills are listed only", () => {
    const rows = Array.from({ length: PERSONAL_RADAR_MAX_AXES + 3 }, (_, index) => area(index, 3));
    const model = buildPersonalRadarModel(rows);
    expect(model.status).toBe("ready");
    if (model.status !== "ready") return;
    expect(model.points).toHaveLength(PERSONAL_RADAR_MAX_AXES);
    expect(model.omittedByCap).toBe(3);
  });
});

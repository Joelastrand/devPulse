import { describe, expect, it } from "vitest";
import { buildOverviewModel } from "./overview-model";
import type { SkillRowDto } from "./skill-profile-view";

function skill(treeId: string, level: number | null): SkillRowDto {
  return { treeId, name: `Ferdighet ${treeId}`, level } as unknown as SkillRowDto;
}

describe("buildOverviewModel (descriptive counts only)", () => {
  const skills = [skill("a", 4), skill("b", 3), skill("c", 2), skill("d", 1), skill("e", null)];

  it("counts assessed skills at level 3 or higher", () => {
    expect(buildOverviewModel(skills).summary.atLeastIndependent).toBe(2);
  });

  it("counts assessed skills out of the visible skills", () => {
    const model = buildOverviewModel(skills);
    expect(model.summary.assessedCount).toBe(4);
    expect(model.summary.totalCount).toBe(5);
    expect(model.unassessedCount).toBe(1);
  });

  it("counts assessed skills at level 1 or 2 as descriptive development areas", () => {
    expect(buildOverviewModel(skills).summary.developmentAreaCount).toBe(2);
  });

  it("keeps unassessed skills as null and never as zero", () => {
    const model = buildOverviewModel(skills);
    expect(model.areas.find((area) => area.treeId === "e")?.level).toBeNull();
  });

  it("has no role, target or expected-level fields", () => {
    const model = buildOverviewModel(skills);
    expect(Object.keys(model).sort()).toEqual(["areas", "summary", "unassessedCount"]);
    expect(Object.keys(model.areas[0] ?? {}).sort()).toEqual(["level", "name", "treeId"]);
  });
});

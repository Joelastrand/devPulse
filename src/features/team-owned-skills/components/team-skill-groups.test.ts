import { describe, expect, it } from "vitest";
import { groupTeamSkillsByCategory } from "./team-skill-groups";

const skill = (name: string, category: string | null | undefined) => ({ name, category });

describe("groupTeamSkillsByCategory", () => {
  it("groups by the stored category, sorted in Norwegian order, keeping the server order inside each group", () => {
    const groups = groupTeamSkillsByCategory([skill("B1", "Backend"), skill("F1", "Frontend"), skill("B2", "Backend")]);

    expect(groups.map((group) => group.category)).toEqual(["Backend", "Frontend"]);
    expect(groups[0]!.items.map((item) => item.name)).toEqual(["B1", "B2"]);
  });

  it("places competencies without a category in one trailing group with a null category", () => {
    const groups = groupTeamSkillsByCategory([skill("Diverse", null), skill("F1", "Frontend"), skill("Ukjent", undefined)]);

    expect(groups.map((group) => group.category)).toEqual(["Frontend", null]);
    expect(groups.at(-1)!.items.map((item) => item.name)).toEqual(["Diverse", "Ukjent"]);
  });

  it("treats a whitespace-only category as having no category, and never invents one", () => {
    const groups = groupTeamSkillsByCategory([skill("Tom", "   ")]);

    expect(groups).toEqual([{ category: null, items: [expect.objectContaining({ name: "Tom" })] }]);
  });

  it("trims the category name before grouping", () => {
    const groups = groupTeamSkillsByCategory([skill("A", " Backend "), skill("B", "Backend")]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe("Backend");
  });

  it("returns no groups for an empty list", () => {
    expect(groupTeamSkillsByCategory([])).toEqual([]);
  });
});

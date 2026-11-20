import { describe, expect, it } from "vitest";
import { summarizeOwnTeamAssessment } from "./OwnTeamCompetenceSummary";

const skill = (skillId: string, active: boolean) => ({
  skillId,
  name: `Kompetanse ${skillId}`,
  description: "",
  category: null,
  guidance: {},
  criteriaVersion: 1,
  active,
  sortOrder: 0,
});

describe("summarizeOwnTeamAssessment", () => {
  it("counts only active competencies and only the person's ratings of them", () => {
    const summary = summarizeOwnTeamAssessment({
      status: "ok",
      canEdit: false,
      truncated: false,
      skills: [skill("a", true), skill("b", true), skill("c", false)],
      own: [
        { skillId: "a", level: 2, outdated: false },
        { skillId: "c", level: 3, outdated: false },
      ],
    } as never);

    expect(summary).toEqual({ active: 2, assessed: 1 });
  });

  it("reports nothing assessed for a team with no ratings", () => {
    const summary = summarizeOwnTeamAssessment({
      status: "ok",
      canEdit: false,
      truncated: false,
      skills: [skill("a", true)],
      own: [],
    } as never);

    expect(summary).toEqual({ active: 1, assessed: 0 });
  });
});

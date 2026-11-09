import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE_MODE, buildCollaborativeAxes, parseProfileMode, type CompetenceAreaForProfile } from "./collaborative-profile";

/** Synthetic fixtures only. */
const area = (treeId: string, status: CompetenceAreaForProfile["status"], teamLevel: number | null): CompetenceAreaForProfile => ({
  treeId,
  label: `Område ${treeId}`,
  status,
  teamLevel,
});

describe("profile mode vocabulary", () => {
  it("defaults to automatic", () => {
    expect(DEFAULT_PROFILE_MODE).toBe("automatic");
  });

  it("accepts only the two modes", () => {
    expect(parseProfileMode("automatic")).toBe("automatic");
    expect(parseProfileMode("collaborative")).toBe("collaborative");
    expect(parseProfileMode("Automatisk")).toBeNull();
    expect(parseProfileMode(null)).toBeNull();
    expect(parseProfileMode(1)).toBeNull();
  });
});

describe("collaborative axes", () => {
  it("includes only active areas", () => {
    const axes = buildCollaborativeAxes(
      [area("a", "active", 2), area("b", "inactive", 3), area("c", "archived", 4)],
      [],
    );
    expect(axes.map((axis) => axis.treeId)).toEqual(["a"]);
  });

  it("ignores needs that belong to inactive or archived areas", () => {
    const axes = buildCollaborativeAxes(
      [area("a", "active", null), area("b", "archived", null)],
      [
        { treeId: "a", requiredLevel: 3 },
        { treeId: "b", requiredLevel: 4 },
      ],
    );
    expect(axes).toEqual([{ treeId: "a", label: "Område a", teamLevel: null, targetLevel: 3 }]);
  });

  it("never fabricates a team value: an unset area stays null", () => {
    const [axis] = buildCollaborativeAxes([area("a", "active", null)], []);
    expect(axis?.teamLevel).toBeNull();
    expect(axis?.targetLevel).toBeNull();
  });

  it("passes a stored value through unchanged so the radar model can reject it", () => {
    const [axis] = buildCollaborativeAxes([area("a", "active", 9)], []);
    expect(axis?.teamLevel).toBe(9);
  });

  it("keeps the order of the areas it was given", () => {
    const axes = buildCollaborativeAxes([area("b", "active", 1), area("a", "active", 2)], []);
    expect(axes.map((axis) => axis.treeId)).toEqual(["b", "a"]);
  });
});

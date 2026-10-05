import { describe, expect, it } from "vitest";

import * as view from "./skill-profile-view";
import { deriveOverview, sortSkillRows, type SkillRowDto } from "./skill-profile-view";

const row = (treeId: string, name: string, level: SkillRowDto["level"] = null): SkillRowDto => ({
  treeId,
  name,
  level,
});

describe("sortSkillRows", () => {
  it("orders by name", () => {
    const sorted = sortSkillRows([row("1", "Test"), row("2", "Arkitektur"), row("3", "Sikkerhet")]);
    expect(sorted.map((r) => r.name)).toEqual(["Arkitektur", "Sikkerhet", "Test"]);
  });

  it("uses nb locale: æ, ø, å sort after z, in that order", () => {
    const sorted = sortSkillRows([row("1", "Åpen"), row("2", "Øvelse"), row("3", "Zebra"), row("4", "Ære")]);
    expect(sorted.map((r) => r.name)).toEqual(["Zebra", "Ære", "Øvelse", "Åpen"]);
  });

  it("breaks name ties deterministically by treeId, regardless of input order", () => {
    const a = row("b-id", "Samme");
    const b = row("a-id", "Samme");
    const c = row("c-id", "Samme");
    expect(sortSkillRows([a, b, c]).map((r) => r.treeId)).toEqual(["a-id", "b-id", "c-id"]);
    expect(sortSkillRows([c, a, b]).map((r) => r.treeId)).toEqual(["a-id", "b-id", "c-id"]);
  });

  it("does not mutate its input and returns a new array", () => {
    const input = [row("2", "B"), row("1", "A")];
    const snapshot = input.map((r) => ({ ...r }));
    const sorted = sortSkillRows(input);
    expect(sorted).not.toBe(input);
    expect(input).toEqual(snapshot);
  });

  it("handles empty input", () => {
    expect(sortSkillRows([])).toEqual([]);
  });

  it("does not sort by level", () => {
    const sorted = sortSkillRows([row("1", "B", 4), row("2", "A", null), row("3", "C", 1)]);
    expect(sorted.map((r) => r.name)).toEqual(["A", "B", "C"]);
  });
});

describe("deriveOverview", () => {
  it("handles an empty list", () => {
    expect(deriveOverview([])).toEqual({
      assessedCount: 0,
      totalCount: 0,
      perLevelCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
    });
  });

  it("counts a list with nothing assessed", () => {
    expect(deriveOverview([row("a", "A"), row("b", "B")])).toEqual({
      assessedCount: 0,
      totalCount: 2,
      perLevelCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
    });
  });

  it("counts a mixed list over the given (visible) rows only", () => {
    const overview = deriveOverview([
      row("a", "A", 1),
      row("b", "B", 3),
      row("c", "C", 3),
      row("d", "D", null),
      row("e", "E", 4),
    ]);
    expect(overview).toEqual({
      assessedCount: 4,
      totalCount: 5,
      perLevelCounts: { 1: 1, 2: 0, 3: 2, 4: 1 },
    });
  });

  it("counts a fully assessed list", () => {
    const overview = deriveOverview([row("a", "A", 2), row("b", "B", 2)]);
    expect(overview.assessedCount).toBe(2);
    expect(overview.totalCount).toBe(2);
    expect(overview.perLevelCounts).toEqual({ 1: 0, 2: 2, 3: 0, 4: 0 });
  });

  it("contains only counts: no ratio, percentage, average or score field", () => {
    const overview = deriveOverview([row("a", "A", 4)]);
    expect(Object.keys(overview).sort()).toEqual(["assessedCount", "perLevelCounts", "totalCount"]);
  });

  it("per-level counts sum to assessedCount", () => {
    const overview = deriveOverview([row("a", "A", 1), row("b", "B", 4), row("c", "C")]);
    const sum = Object.values(overview.perLevelCounts).reduce((x, y) => x + y, 0);
    expect(sum).toBe(overview.assessedCount);
  });
});

describe("module surface", () => {
  it("exports no mean/sum/percentage/score/rank helper", () => {
    expect(Object.keys(view).filter((k) => /average|(^|_)mean($|_)|(^|[a-z])sum|score|percent|rank|weight/i.test(k))).toEqual([]);
  });
});

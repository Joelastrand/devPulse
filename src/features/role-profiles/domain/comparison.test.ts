import { describe, expect, it } from "vitest";
import { compareWithRole } from "./comparison";

const expectation = (treeId: string, expectedLevel: 2 | 3 | 4) => ({ treeId, expectedLevel });

describe("compareWithRole", () => {
  it("marks a level equal to the expectation as meets", () => {
    const rows = compareWithRole({
      expectations: [expectation("api", 3)],
      ownLevels: new Map([["api", 3]]),
      unavailableTreeIds: new Set(),
    });
    expect(rows).toEqual([{ treeId: "api", expectedLevel: 3, status: "meets", ownLevel: 3 }]);
  });

  it("marks a level above the expectation as meets", () => {
    const rows = compareWithRole({
      expectations: [expectation("api", 2)],
      ownLevels: new Map([["api", 4]]),
      unavailableTreeIds: new Set(),
    });
    expect(rows[0]).toMatchObject({ status: "meets", ownLevel: 4 });
  });

  it("marks a level below the expectation as development_opportunity", () => {
    const rows = compareWithRole({
      expectations: [expectation("api", 4)],
      ownLevels: new Map([["api", 3]]),
      unavailableTreeIds: new Set(),
    });
    expect(rows[0]).toMatchObject({ status: "development_opportunity", ownLevel: 3 });
  });

  it("marks a missing C1 level as not_assessed and never as a level", () => {
    const rows = compareWithRole({
      expectations: [expectation("api", 2)],
      ownLevels: new Map(),
      unavailableTreeIds: new Set(),
    });
    expect(rows).toEqual([{ treeId: "api", expectedLevel: 2, status: "not_assessed", ownLevel: null }]);
  });

  it("marks a missing SkillTree as area_unavailable with a null ownLevel, even when a level exists", () => {
    const rows = compareWithRole({
      expectations: [expectation("gone", 2)],
      ownLevels: new Map([["gone", 4]]),
      unavailableTreeIds: new Set(["gone"]),
    });
    expect(rows).toEqual([{ treeId: "gone", expectedLevel: 2, status: "area_unavailable", ownLevel: null }]);
  });

  it("marks a missing SkillTree as area_unavailable when no level exists", () => {
    const rows = compareWithRole({
      expectations: [expectation("gone", 2)],
      ownLevels: new Map(),
      unavailableTreeIds: new Set(["gone"]),
    });
    expect(rows[0]).toMatchObject({ status: "area_unavailable", ownLevel: null });
  });

  it("keeps expectation order for a mixed-status input, without sorting by status", () => {
    const rows = compareWithRole({
      expectations: [expectation("a", 2), expectation("b", 4), expectation("c", 3), expectation("d", 2)],
      ownLevels: new Map([
        ["a", 2],
        ["b", 2],
        ["c", 3],
      ]),
      unavailableTreeIds: new Set(["d"]),
    });
    expect(rows.map((row) => row.treeId)).toEqual(["a", "b", "c", "d"]);
    expect(rows.map((row) => row.status)).toEqual(["meets", "development_opportunity", "meets", "area_unavailable"]);
  });

  it("returns an empty list for zero expectations", () => {
    expect(compareWithRole({ expectations: [], ownLevels: new Map(), unavailableTreeIds: new Set() })).toEqual([]);
  });

  it("emits only the four row keys and no aggregate output", () => {
    const rows = compareWithRole({
      expectations: [expectation("api", 2)],
      ownLevels: new Map([["api", 2]]),
      unavailableTreeIds: new Set(),
    });
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["expectedLevel", "ownLevel", "status", "treeId"]);
  });
});

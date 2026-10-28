import type { RoleExpectation, RoleExpectedLevel } from "./role-definition";

export type ComparisonStatus = "meets" | "development_opportunity" | "not_assessed" | "area_unavailable";

export interface ComparisonRow {
  treeId: string;
  expectedLevel: RoleExpectedLevel;
  status: ComparisonStatus;
  ownLevel: number | null;
}

export interface ComparisonInput {
  expectations: readonly RoleExpectation[];
  /** Valid C1 levels by `treeId`. Any `treeId` absent here has no level (BR-11). */
  ownLevels: ReadonlyMap<string, number>;
  /** `treeId`s whose SkillTree is missing or invalid. Takes precedence over `not_assessed`. */
  unavailableTreeIds: ReadonlySet<string>;
}

/**
 * Derives one row per expectation, in expectation order (BR-12). Pure: no
 * persistence, no totals, no ordering by status. Absence of a level is never
 * treated as a level, so it yields `not_assessed` (BR-11).
 */
export function compareWithRole(input: ComparisonInput): ComparisonRow[] {
  return input.expectations.map(({ treeId, expectedLevel }) => {
    if (input.unavailableTreeIds.has(treeId)) {
      return { treeId, expectedLevel, status: "area_unavailable", ownLevel: null };
    }
    const ownLevel = input.ownLevels.get(treeId);
    if (ownLevel === undefined) {
      return { treeId, expectedLevel, status: "not_assessed", ownLevel: null };
    }
    const status = ownLevel >= expectedLevel ? "meets" : "development_opportunity";
    return { treeId, expectedLevel, status, ownLevel };
  });
}

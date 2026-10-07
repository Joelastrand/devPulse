import { describe, expect, it } from "vitest";
import {
  SKILL_CONTRIBUTION_NOTICE_VERSION,
  SKILL_COVERAGE_MIN_CONTRIBUTORS,
  TEAM_SKILL_COHORT_SCAN_MAX,
} from "./skill-coverage-policy";

describe("skill coverage policy constants", () => {
  it("pins the privacy threshold to 5 so a change is a deliberate edit", () => {
    expect(SKILL_COVERAGE_MIN_CONTRIBUTORS).toBe(5);
  });

  it("pins the notice version to 1", () => {
    expect(SKILL_CONTRIBUTION_NOTICE_VERSION).toBe(1);
  });

  it("pins the cohort scan bound to 500", () => {
    expect(TEAM_SKILL_COHORT_SCAN_MAX).toBe(500);
  });
});

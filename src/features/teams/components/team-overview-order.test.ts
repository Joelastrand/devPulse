import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Team overview composition (reference 18): header with identity, metrics and actions, then the summary cards, the
 * projects/next-steps row and the compact challenges card. Detailed workflows are not part of the overview.
 */
const source = readFileSync(fileURLToPath(new URL("./TeamDetail.tsx", import.meta.url)), "utf8");
const overviewBranch = source.slice(source.indexOf('if (result.status === "authorized" || result.status === "results_unavailable")'));

describe("team overview composition", () => {
  it("renders the header metrics and actions before the overview summary", () => {
    const header = overviewBranch.indexOf("<TeamHeading");
    const metrics = overviewBranch.indexOf("<TeamHeaderMetrics");
    const summary = overviewBranch.indexOf("<TeamOversiktSummary");
    expect(header).toBeGreaterThan(-1);
    expect(metrics).toBeGreaterThan(header);
    expect(summary).toBeGreaterThan(metrics);
  });

  it("embeds no detailed workflow in the overview branch", () => {
    for (const marker of ["<ChallengeSubmissionPanel", "<ForumSection", "<TeamSkillSection", "<TeamSkillNeedsSection", "<TeamRosterSection", "<TeamVisibilitySettings", "<TeamSummaryStrip"]) {
      expect(overviewBranch).not.toContain(marker);
    }
  });
});

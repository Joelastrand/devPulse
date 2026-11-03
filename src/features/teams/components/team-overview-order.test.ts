import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Team overview section order (Product Experience TASK-040): Pulse, Competency,
 * Needs and coverage, Forum and challenges, Members. The Roadmap summary is not a
 * separate section in this view; the planning scope carries the competency paths.
 */
const source = readFileSync(fileURLToPath(new URL("./TeamDetail.tsx", import.meta.url)), "utf8");

describe("team overview section order", () => {
  it.each(["authorized", "results_unavailable"])("orders the activity zone in the %s branch", () => {
    const zone = source.slice(source.indexOf("<TeamaktivitetZone>"), source.indexOf("</TeamaktivitetZone>"));
    const order = ["<RoadmapPlanningScope", "<TeamSkillNeedsSection", "<ChallengesSection", "{forumEnabled && (", "<TeamRosterSection"].map((marker) => zone.indexOf(marker));
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });

  it("places the summary strip before the Pulse zone", () => {
    const strip = source.indexOf("<TeamSummaryStrip");
    const pulse = source.indexOf("<ResultaterZone>", strip);
    expect(strip).toBeGreaterThan(-1);
    expect(pulse).toBeGreaterThan(strip);
    expect(source.slice(strip, pulse)).not.toContain("return (");
  });
});

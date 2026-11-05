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
  it("keeps the results_unavailable activity order: planning, needs, challenges, forum, members", () => {
    const branch = source.slice(source.indexOf("if (result.status === \"results_unavailable\")"), source.indexOf("if (result.status === \"authorized\")"));
    const zone = branch.slice(branch.indexOf("<TeamaktivitetZone>"), branch.indexOf("</TeamaktivitetZone>"));
    const order = ["<TeamSkillSection", "<TeamSkillNeedsSection", "<ChallengesSection", "{forumEnabled && (", "<TeamRosterSection"].map((marker) => zone.indexOf(marker));
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });

  it("orders the authorized activity zone: planning, needs, chart, challenges, members, forum (TASK-029)", () => {
    const authorized = source.slice(source.indexOf("if (result.status === \"authorized\")"));
    const zone = authorized.slice(authorized.indexOf("<TeamaktivitetZone>"), authorized.indexOf("</TeamaktivitetZone>"));
    const order = ["<TeamSkillSection", "<TeamSkillNeedsSection", "<LazyTrendChart", "<ChallengesSection", "<TeamRosterSection", "{forumEnabled && ("].map((marker) => zone.indexOf(marker));
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });

  it("places the team overview summary row, fed by the single roadmap scope, before the Pulse zone (TASK-028)", () => {
    const authorized = source.slice(source.indexOf("if (result.status === \"authorized\")"));
    const scope = authorized.indexOf("<RoadmapPlanningScope");
    const summary = authorized.indexOf("<TeamOverviewSummary");
    const pulse = authorized.indexOf("<ResultaterZone>");
    expect(scope).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(scope);
    expect(pulse).toBeGreaterThan(summary);
  });

  it("places the summary strip before the Pulse zone", () => {
    const strip = source.indexOf("<TeamSummaryStrip");
    const pulse = source.indexOf("<ResultaterZone>", strip);
    expect(strip).toBeGreaterThan(-1);
    expect(pulse).toBeGreaterThan(strip);
    expect(source.slice(strip, pulse)).not.toContain("return (");
  });

  it("renders the summary values inside the team header, not as a separate band (TASK-010 / D-8)", () => {
    const header = source.indexOf("<TeamHeading name={result.name} teamId={teamId} summary=");
    const strip = source.indexOf("<TeamSummaryStrip");
    const routeNav = source.indexOf("<TeamRouteNav", header);
    expect(header).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(header);
    expect(strip).toBeLessThan(routeNav);
  });
});

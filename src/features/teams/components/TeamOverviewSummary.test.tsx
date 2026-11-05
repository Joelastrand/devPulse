// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RoadmapItemView } from "../../roadmap/server/list-roadmap-items";
import { TEAM_OVERVIEW_SUMMARY_COPY, TeamOverviewSummary } from "./TeamOverviewSummary";

function plan(overrides: Partial<RoadmapItemView> & Pick<RoadmapItemView, "treeId">): RoadmapItemView {
  return {
    areaName: "Containere",
    targetNodeId: "node-1",
    targetLabel: "Grunnleggende",
    targetAvailable: true,
    tracking: { state: "tracked", currentNodeId: null },
    priority: "medium",
    status: "planned",
    startDate: null,
    targetDate: null,
    owner: null,
    overdue: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("TeamOverviewSummary (visual-fidelity TASK-028)", () => {
  it("shows the open challenge count and the active plan count from the loaded reads", () => {
    render(
      <TeamOverviewSummary
        teamId="team-1"
        openChallenges={3}
        plans={{
          phase: "loaded",
          items: [
            plan({ treeId: "a", status: "active" }),
            plan({ treeId: "b", status: "planned" }),
            plan({ treeId: "c", status: "active" }),
          ],
        }}
      />,
    );

    const challenges = screen.getByRole("region", { name: TEAM_OVERVIEW_SUMMARY_COPY.challengesHeading });
    expect(within(challenges).getByText("3")).toBeTruthy();
    const plans = screen.getByRole("region", { name: TEAM_OVERVIEW_SUMMARY_COPY.plansHeading });
    expect(within(plans).getByText("2")).toBeTruthy();
  });

  it("shows a section-scoped error for challenges without hiding the plan card or next steps", () => {
    render(<TeamOverviewSummary teamId="team-1" openChallenges={null} plans={{ phase: "loaded", items: [] }} />);

    const challenges = screen.getByRole("region", { name: TEAM_OVERVIEW_SUMMARY_COPY.challengesHeading });
    expect(within(challenges).getByText(TEAM_OVERVIEW_SUMMARY_COPY.challengesUnavailable)).toBeTruthy();
    expect(screen.getByText(TEAM_OVERVIEW_SUMMARY_COPY.noPlans)).toBeTruthy();
  });

  it("shows the plan card error and the next-steps error independently of the challenge count", () => {
    render(<TeamOverviewSummary teamId="team-1" openChallenges={0} plans={{ phase: "error" }} />);

    expect(screen.getByText(TEAM_OVERVIEW_SUMMARY_COPY.plansUnavailable)).toBeTruthy();
    expect(screen.getByText(TEAM_OVERVIEW_SUMMARY_COPY.nextStepsUnavailable)).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("lists the next steps from the roadmap read, non-archived, in presentation order, linked to the team roadmap", () => {
    render(
      <TeamOverviewSummary
        teamId="team-1"
        openChallenges={0}
        plans={{
          phase: "loaded",
          items: [
            plan({ treeId: "done", areaName: "Ferdig område", status: "completed", targetDate: "2026-02-01" }),
            plan({ treeId: "archived", areaName: "Arkivert område", archived: true, status: "active" }),
            plan({ treeId: "active", areaName: "Aktivt område", status: "active", targetDate: "2026-03-15" }),
          ],
        }}
      />,
    );

    const panel = screen.getByRole("region", { name: TEAM_OVERVIEW_SUMMARY_COPY.nextStepsHeading });
    const items = within(panel).getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("Aktivt område");
    expect(items[0]).toContain("15.03.2026");
    expect(items[1]).toContain("Ferdig område");
    expect(within(panel).queryByText("Arkivert område")).toBeNull();

    const link = within(panel).getByRole("link", { name: /Gå til roadmap/ });
    expect(link.getAttribute("href")).toBe("/teams/team-1/roadmap");
  });

  it("shows loading state only in the plan card and next-steps panel while the roadmap read is pending", () => {
    render(<TeamOverviewSummary teamId="team-1" openChallenges={1} plans={{ phase: "loading" }} />);

    const challenges = screen.getByRole("region", { name: TEAM_OVERVIEW_SUMMARY_COPY.challengesHeading });
    expect(within(challenges).getByText("1")).toBeTruthy();
    const plans = screen.getByRole("region", { name: TEAM_OVERVIEW_SUMMARY_COPY.plansHeading });
    expect(within(plans).queryByText("0")).toBeNull();
    expect(screen.queryByText(TEAM_OVERVIEW_SUMMARY_COPY.noPlans)).toBeNull();
  });

  it("never renders a coverage or progress percentage in the summary row", () => {
    render(
      <TeamOverviewSummary
        teamId="team-1"
        openChallenges={2}
        plans={{ phase: "loaded", items: [plan({ treeId: "a", status: "active" })] }}
      />,
    );

    expect(screen.queryByText(/%/)).toBeNull();
  });
});

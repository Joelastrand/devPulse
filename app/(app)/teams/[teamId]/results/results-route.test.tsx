// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";

vi.mock("../../../../../src/features/teams/components/TeamPageHeader", () => ({
  TeamPageHeader: ({ teamId }: { teamId: string }) => <div data-testid="team-header" data-team={teamId} />,
}));

vi.mock("../../../../../src/features/teams/components/TeamResultsView", () => ({
  TeamResultsView: ({ teamId }: { teamId: string }): ReactElement => (
    <div data-testid="team-results-view" data-team={teamId} />
  ),
}));

const { default: TeamResultsPage } = await import("./page");

describe("/teams/[teamId]/results route (team-experience-redesign BR-5)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the shared team header and the results view for the awaited teamId", async () => {
    const element = await TeamResultsPage({ params: Promise.resolve({ teamId: "team-42" }) });
    render(element);

    expect(screen.getByTestId("team-header").getAttribute("data-team")).toBe("team-42");
    expect(screen.getByTestId("team-results-view").getAttribute("data-team")).toBe("team-42");
  });

  it("has no redundant back link, because team navigation is already shown", async () => {
    const element = await TeamResultsPage({ params: Promise.resolve({ teamId: "team-42" }) });
    render(element);

    expect(within(document.body).queryAllByRole("link", { name: /tilbake/i })).toHaveLength(0);
  });
});

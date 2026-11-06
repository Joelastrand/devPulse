// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { competenceRouteCopy } from "../../../../src/features/teams/competence-route-copy";

const headerMock = vi.fn<(props: { teamId: string }) => ReactElement>(() => <div data-testid="team-header" />);

vi.mock("../../../../src/features/teams/components/TeamPageHeader", () => ({
  TeamPageHeader: headerMock,
}));

vi.mock("../../../../src/features/team-skills/components/TeamCompetenceCoverage", () => ({
  TeamCompetenceCoverage: ({ teamId }: { teamId: string }) => <div data-testid="team-competence-coverage" data-team={teamId} />,
}));

vi.mock("../../../../src/features/team-competence-plan/components/CompetencePlanSection", () => ({
  CompetencePlanSection: ({ teamId }: { teamId: string }) => <div data-testid="competence-plan-section" data-team={teamId} />,
}));

const { default: CompetencePlanPage } = await import("./competence-plan/page");
const { default: CompetencePage } = await import("./competence/page");

describe("competence route entry points (TASK-001)", () => {
  afterEach(() => {
    cleanup();
    headerMock.mockClear();
  });

  it("competence-plan renders the shared team header for the awaited teamId", async () => {
    render(await CompetencePlanPage({ params: Promise.resolve({ teamId: "team-1" }) }));

    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByTestId("team-header")).toBeTruthy();
    expect(headerMock.mock.calls[0]?.[0]).toEqual({ teamId: "team-1" });
    expect(screen.getByTestId("competence-plan-section").getAttribute("data-team")).toBe("team-1");
    expect(competenceRouteCopy.competencePlanPending).toBeTruthy();
  });

  it("competence renders the shared team header for the awaited teamId", async () => {
    cleanup();
    render(await CompetencePage({ params: Promise.resolve({ teamId: "team-2" }) }));

    expect(screen.getByTestId("team-header")).toBeTruthy();
    expect(headerMock.mock.calls[0]?.[0]).toEqual({ teamId: "team-2" });
    expect(screen.getByTestId("team-competence-coverage").getAttribute("data-team")).toBe("team-2");
  });
});

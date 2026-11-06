// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { surveysCopy } from "../../surveys/copy";
import { teamsCopy } from "../copy";

const observeIdTokenMock = vi.fn();
const fetchTeamResultsMock = vi.fn();
const fetchCurrentTeamSurveyMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../../results/client/team-results-gateway", () => ({
  fetchTeamResults: fetchTeamResultsMock,
}));

vi.mock("../../surveys/client/current-team-survey-gateway", () => ({
  fetchCurrentTeamSurvey: fetchCurrentTeamSurveyMock,
}));

// The chart is code-split and asserted separately; here only its presence matters.
vi.mock("../../results/components/TrendChart", () => ({
  TrendChart: () => <div data-testid="trend-chart" />,
}));

const { TeamResultsView } = await import("./TeamResultsView");

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

const PUBLISHED_RESULTS = {
  status: "ok",
  teamId: "team-1",
  results: [
    { surveyId: "survey-34", date: "2026-08-17T00:00:00.000Z", minimumResponses: 5, status: "insufficient" },
    { surveyId: "survey-35", date: "2026-08-24T00:00:00.000Z", minimumResponses: 5, status: "insufficient" },
  ],
};

const OPEN_SURVEY = {
  status: "ok",
  survey: {
    surveyId: "survey-36",
    title: "Vår puls",
    accessMode: "authenticated",
    lifecycle: "open",
  },
};

describe("TeamResultsView (team-experience-redesign BR-5)", () => {
  beforeEach(() => {
    fetchTeamResultsMock.mockReset();
    fetchCurrentTeamSurveyMock.mockReset();
    observeIdTokenMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a Norwegian loading state while the results read is pending", () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamResultsMock.mockReturnValue(new Promise(() => {}));
    fetchCurrentTeamSurveyMock.mockReturnValue(new Promise(() => {}));

    render(<TeamResultsView teamId="team-1" />);

    expect(screen.getByRole("status").textContent).toMatch(/laster resultater/i);
  });

  it("renders the survey history, current survey and trend table for an authorized member", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);
    fetchCurrentTeamSurveyMock.mockResolvedValue(OPEN_SURVEY);

    render(<TeamResultsView teamId="team-1" />);

    await waitFor(() => expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "team-1"));
    expect(await screen.findByText("Vår puls")).toBeTruthy();
    expect(screen.getByRole("link", { name: surveysCopy.teamCurrent.answerLink })).toBeTruthy();
    expect(screen.getByTestId("trend-chart")).toBeTruthy();
  });

  it("shows the forbidden message and no survey content when the results read is denied", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamResultsMock.mockResolvedValue({ status: "forbidden" });
    fetchCurrentTeamSurveyMock.mockResolvedValue(OPEN_SURVEY);

    render(<TeamResultsView teamId="team-1" />);

    expect(await screen.findByText(teamsCopy.results.forbidden)).toBeTruthy();
    expect(screen.queryByText("Vår puls")).toBeNull();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
  });

  it("shows the error message when the results read fails", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });
    fetchCurrentTeamSurveyMock.mockResolvedValue(OPEN_SURVEY);

    render(<TeamResultsView teamId="team-1" />);

    expect((await screen.findByRole("alert")).textContent).toBe(teamsCopy.results.error);
  });

  it("prompts sign-in and never reads results when signed out", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<TeamResultsView teamId="team-1" />);

    expect(await screen.findByRole("link", { name: teamsCopy.detail.signInLink })).toBeTruthy();
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("shows a section-level survey error without hiding the results when the survey read fails", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);
    fetchCurrentTeamSurveyMock.mockResolvedValue({ status: "read_failed" });

    render(<TeamResultsView teamId="team-1" />);

    expect(await screen.findByText(surveysCopy.teamCurrent.error)).toBeTruthy();
    expect(screen.getByTestId("trend-chart")).toBeTruthy();
  });

  it("renders no chart when there are no results to chart", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamResultsMock.mockResolvedValue({ status: "ok", teamId: "team-1", results: [] });
    fetchCurrentTeamSurveyMock.mockResolvedValue({ status: "ok", survey: null });

    render(<TeamResultsView teamId="team-1" />);

    await waitFor(() => expect(fetchCurrentTeamSurveyMock).toHaveBeenCalled());
    expect(await screen.findByText(surveysCopy.teamCurrent.empty)).toBeTruthy();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
  });
});

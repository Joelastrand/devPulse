// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SurveyResultsFetchResult } from "../client/survey-builder-gateway";

const fetchTeamResultsSurveys = vi.fn();
const fetchSurveyResults = vi.fn();

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const { useEffect } = await import("react");
  return {
    useAuthGatedResource: (callback: (token: string | null) => void, deps: readonly unknown[]) => {
      useEffect(() => {
        callback("test-token");
        // The real hook re-runs the callback when its dependencies change; the test has fixed deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
    },
  };
});

vi.mock("../client/survey-builder-gateway", () => ({
  fetchTeamResultsSurveys: (...args: unknown[]) => fetchTeamResultsSurveys(...args),
  fetchSurveyResults: (...args: unknown[]) => fetchSurveyResults(...args),
}));

const { TeamSurveyResultsSection } = await import("./TeamSurveyResultsSection");

const SURVEY = { surveyId: "survey-1", title: "Oktoberpuls", minimumResponses: 3 };

const PUBLISHED: SurveyResultsFetchResult = {
  status: "published",
  survey: { surveyId: "survey-1", title: "Oktoberpuls", accessMode: "public", minimumResponses: 3 },
  responseCount: 3,
  questions: [
    {
      questionId: "energy",
      prompt: "Energi",
      type: "rating",
      status: "published",
      answeredCount: 3,
      mean: 4,
      distribution: { "1": 0, "2": 0, "3": 1, "4": 1, "5": 1 },
    },
    { questionId: "idea", prompt: "Idé", type: "free_text", status: "restricted" },
  ],
};

beforeEach(() => {
  fetchTeamResultsSurveys.mockReset();
  fetchSurveyResults.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("TeamSurveyResultsSection", () => {
  it("shows an empty state when the team has no closed configurable surveys", async () => {
    fetchTeamResultsSurveys.mockResolvedValue({ status: "ok", surveys: [] });

    render(<TeamSurveyResultsSection teamId="team-1" />);

    expect(await screen.findByText("Ingen avsluttede undersøkelser med egne spørsmål ennå.")).toBeTruthy();
  });

  it("shows a generic error, not survey content, when the list cannot be loaded", async () => {
    fetchTeamResultsSurveys.mockResolvedValue({ status: "read_failed" });

    render(<TeamSurveyResultsSection teamId="team-1" />);

    expect(await screen.findByText("Undersøkelsene kunne ikke lastes.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vis resultater" })).toBeNull();
  });

  it("loads a survey's per-question results on demand and shows a restricted free-text marker", async () => {
    fetchTeamResultsSurveys.mockResolvedValue({ status: "ok", surveys: [SURVEY] });
    fetchSurveyResults.mockResolvedValue(PUBLISHED);
    const user = userEvent.setup();

    render(<TeamSurveyResultsSection teamId="team-1" />);
    await user.click(await screen.findByRole("button", { name: "Vis resultater" }));

    expect(await screen.findByText("Snitt:", { exact: false })).toBeTruthy();
    expect(fetchSurveyResults).toHaveBeenCalledWith("test-token", "team-1", "survey-1");
    expect(
      screen.getByText("Fritekstsvar vises bare til teammedlemmer. Administratorer uten medlemskap får ikke se enkeltsvar."),
    ).toBeTruthy();
  });

  it("shows the survey's insufficient-responses notice and no counts below the threshold", async () => {
    fetchTeamResultsSurveys.mockResolvedValue({ status: "ok", surveys: [SURVEY] });
    fetchSurveyResults.mockResolvedValue({
      status: "insufficient",
      survey: { surveyId: "survey-1", accessMode: "public", minimumResponses: 3 },
    });
    const user = userEvent.setup();

    render(<TeamSurveyResultsSection teamId="team-1" />);
    await user.click(await screen.findByRole("button", { name: "Vis resultater" }));

    expect(await screen.findByText("Resultatene vises først når minst 3 har svart.")).toBeTruthy();
    expect(screen.queryByText("Fordeling")).toBeNull();
  });

  it("shows a read-failed notice when a survey's results cannot be loaded", async () => {
    fetchTeamResultsSurveys.mockResolvedValue({ status: "ok", surveys: [SURVEY] });
    fetchSurveyResults.mockResolvedValue({ status: "read_failed" });
    const user = userEvent.setup();

    render(<TeamSurveyResultsSection teamId="team-1" />);
    await user.click(await screen.findByRole("button", { name: "Vis resultater" }));

    expect(await screen.findByText("Resultatene kunne ikke lastes.")).toBeTruthy();
  });
});

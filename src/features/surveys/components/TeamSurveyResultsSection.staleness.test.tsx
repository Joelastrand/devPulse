// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SurveyResultsFetchResult } from "../client/survey-builder-gateway";

/**
 * The real `useAuthGatedResource` runs against a controllable identity stream, so the generation guard under test is the
 * production one.
 */
const authStream = vi.hoisted(() => ({
  token: "token-a" as string | null,
  listeners: new Set<(token: string | null) => void>(),
}));

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: (callback: (token: string | null) => void) => {
    authStream.listeners.add(callback);
    callback(authStream.token);
    return () => {
      authStream.listeners.delete(callback);
    };
  },
}));

const fetchTeamResultsSurveys = vi.fn();
const fetchSurveyResults = vi.fn();

vi.mock("../client/survey-builder-gateway", () => ({
  fetchTeamResultsSurveys: (...args: unknown[]) => fetchTeamResultsSurveys(...args),
  fetchSurveyResults: (...args: unknown[]) => fetchSurveyResults(...args),
}));

const { TeamSurveyResultsSection } = await import("./TeamSurveyResultsSection");

const SURVEY = { surveyId: "survey-1", title: "Oktoberpuls", minimumResponses: 3 };

/** Account A's published result: it carries a distinctive per-question label that must never show for account B. */
const ACCOUNT_A_PUBLISHED: SurveyResultsFetchResult = {
  status: "published",
  survey: { surveyId: "survey-1", title: "Oktoberpuls", accessMode: "public", minimumResponses: 3 },
  responseCount: 3,
  questions: [
    {
      questionId: "energy",
      prompt: "Kun for konto A",
      type: "rating",
      status: "published",
      answeredCount: 3,
      mean: 4,
      distribution: { "1": 0, "2": 0, "3": 1, "4": 1, "5": 1 },
    },
  ],
};

const ACCOUNT_B_INSUFFICIENT: SurveyResultsFetchResult = {
  status: "insufficient",
  survey: { surveyId: "survey-1", accessMode: "public", minimumResponses: 3 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function emitAuth(token: string | null) {
  authStream.token = token;
  for (const listener of [...authStream.listeners]) listener(token);
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("TeamSurveyResultsSection — late results after an identity change", () => {
  afterEach(() => {
    cleanup();
    fetchTeamResultsSurveys.mockReset();
    fetchSurveyResults.mockReset();
    authStream.token = "token-a";
    authStream.listeners.clear();
  });

  it("does not cache account A's late result for account B, so B's own result is requested and shown", async () => {
    const pendingA = deferred<SurveyResultsFetchResult>();
    fetchTeamResultsSurveys.mockResolvedValue({ status: "ok", surveys: [SURVEY] });
    fetchSurveyResults.mockImplementation((token: string) =>
      token === "token-a" ? pendingA.promise : Promise.resolve(ACCOUNT_B_INSUFFICIENT),
    );
    const user = userEvent.setup();
    render(<TeamSurveyResultsSection open onOpenChange={() => undefined} teamId="team-1" />);

    await user.click(await screen.findByRole("button", { name: "Vis resultater" }));
    expect(fetchSurveyResults).toHaveBeenCalledWith("token-a", "team-1", "survey-1");

    emitAuth("token-b");
    await screen.findByRole("button", { name: "Vis resultater" });

    // Account A's response arrives after the switch. It must not be stored for account B.
    pendingA.resolve(ACCOUNT_A_PUBLISHED);
    await flush();

    await user.click(screen.getByRole("button", { name: "Vis resultater" }));
    await waitFor(() => expect(fetchSurveyResults).toHaveBeenCalledWith("token-b", "team-1", "survey-1"));
    expect(await screen.findByText("Resultatene vises først når minst 3 har svart.")).toBeTruthy();
    expect(screen.queryByText("Kun for konto A")).toBeNull();
  });

  it("does not cache a late result from a previous team after the page moves to another team", async () => {
    const pendingTeamOne = deferred<SurveyResultsFetchResult>();
    fetchTeamResultsSurveys.mockResolvedValue({ status: "ok", surveys: [SURVEY] });
    fetchSurveyResults.mockImplementation((_token: string, teamId: string) =>
      teamId === "team-1" ? pendingTeamOne.promise : Promise.resolve(ACCOUNT_B_INSUFFICIENT),
    );
    const user = userEvent.setup();
    const { rerender } = render(<TeamSurveyResultsSection open onOpenChange={() => undefined} teamId="team-1" />);
    await user.click(await screen.findByRole("button", { name: "Vis resultater" }));

    rerender(<TeamSurveyResultsSection open onOpenChange={() => undefined} teamId="team-2" />);
    await screen.findByRole("button", { name: "Vis resultater" });
    pendingTeamOne.resolve(ACCOUNT_A_PUBLISHED);
    await flush();

    await user.click(screen.getByRole("button", { name: "Vis resultater" }));
    await waitFor(() => expect(fetchSurveyResults).toHaveBeenCalledWith("token-a", "team-2", "survey-1"));
    expect(screen.queryByText("Kun for konto A")).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { teamsCopy } from "../copy";

const observeIdTokenMock = vi.fn();
const fetchTeamsOverviewMock = vi.fn();
const requestTeamAccessMock = vi.fn();
const fetchTeamResultsMock = vi.fn();
const fetchCurrentTeamSurveyMock = vi.fn();
const fetchTeamChallengesMock = vi.fn();
const submitChallengeMock = vi.fn();
const fetchTeamThreadsMock = vi.fn();
const createThreadMock = vi.fn();
const fetchTeamSkillsMock = vi.fn();
const reportTeamSkillProgressMock = vi.fn();

/**
 * Records every time `TrendChart`'s module is actually loaded, without
 * changing its real behavior (`importOriginal()` passthrough) — most tests
 * exercise the real, unmocked `TrendChart` (docs/features/
 * performance-phase-a/SPEC.md — TASK-003: "at least one validation path
 * exercises the real production integration"). Module resolution is cached
 * by the JS engine after the first successful `import()` for the lifetime of
 * this file, so tests that care about "was this loaded" compare a
 * before/after call count rather than asserting an absolute zero — robust
 * regardless of which earlier test in this file already triggered the load.
 */
const trendChartModuleLoadedMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/teams-overview-gateway", () => ({
  fetchTeamsOverview: fetchTeamsOverviewMock,
  requestTeamAccess: requestTeamAccessMock,
}));

vi.mock("../../results/client/team-results-gateway", () => ({
  fetchTeamResults: fetchTeamResultsMock,
}));

vi.mock("../../surveys/client/current-team-survey-gateway", () => ({
  fetchCurrentTeamSurvey: fetchCurrentTeamSurveyMock,
}));

vi.mock("../../challenges/client/challenges-gateway", () => ({
  fetchTeamChallenges: fetchTeamChallengesMock,
  submitChallenge: submitChallengeMock,
}));

vi.mock("../../forum/client/forum-gateway", () => ({
  fetchTeamThreads: fetchTeamThreadsMock,
  createThread: createThreadMock,
}));

vi.mock("../../skill-trees/client/skill-trees-gateway", () => ({
  fetchTeamSkills: fetchTeamSkillsMock,
  reportTeamSkillProgress: reportTeamSkillProgressMock,
}));

vi.mock("../../results/components/TrendChart", async (importOriginal) => {
  trendChartModuleLoadedMock();
  return importOriginal<typeof import("../../results/components/TrendChart")>();
});

const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

const { TeamDetail } = await import("./TeamDetail");

/** The no-current-survey outcome — the harmless default most tests want, since they aren't exercising this section. */
const NO_CURRENT_SURVEY = { status: "ok", survey: null };

/** The empty-challenge-list outcome — the harmless default most tests want, since they aren't exercising this section. `canSubmit: true` matches these tests' default `relationship: "member"` fixture. */
const NO_CHALLENGES = { status: "ok", challenges: [], canSubmit: true };

/** The empty-thread-list outcome — the harmless default most tests want, since they aren't exercising the forum section. */
const NO_THREADS = { status: "ok", threads: [] };

/** The empty-skill-list outcome — the harmless default most tests want, since they aren't exercising the skill section. */
const NO_SKILLS = { status: "ok", skills: [], canReportProgress: true };

const PUBLISHED_RESULTS = {
  status: "ok",
  teamId: "team-1",
  results: [
    {
      surveyId: "survey-34",
      date: "2026-08-17T00:00:00.000Z",
      minimumResponses: 5,
      status: "insufficient",
    },
    {
      surveyId: "survey-35",
      date: "2026-08-24T00:00:00.000Z",
      minimumResponses: 5,
      status: "published",
      mean: { flow: 3.2, stress: 2.8, fun: 4.1 },
      count: 7,
    },
  ],
};

const INSUFFICIENT_RESULTS = {
  status: "ok",
  teamId: "team-1",
  results: [
    {
      surveyId: "survey-35",
      date: "2026-08-24T00:00:00.000Z",
      minimumResponses: 5,
      status: "insufficient",
    },
  ],
};

/** Simulates the auth subscription immediately emitting one token value on every (re-)subscribe. */
function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

/**
 * Captures the `observeIdToken` callback so a test can fire multiple auth
 * events (sign-out, account switch, token refresh) at will.
 */
function capturingObserver() {
  let callback: ((token: string | null) => void) | null = null;
  observeIdTokenMock.mockImplementation((cb: (token: string | null) => void) => {
    callback = cb;
    return () => {};
  });
  return {
    emit(token: string | null) {
      callback?.(token);
    },
  };
}

/** Queues one manually-resolvable promise per call, in call order. */
function queuedCalls(mock: ReturnType<typeof vi.fn>) {
  const resolvers: Array<(value: unknown) => void> = [];
  mock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return {
    resolve(callIndex: number, value: unknown) {
      resolvers[callIndex](value);
    },
  };
}

/** A manually-resolvable/-rejectable promise, used to hold the chart module's dynamic import pending on demand — never a real timer. */
function deferredPromise<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TeamDetail", () => {
  beforeEach(() => {
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
    fetchTeamResultsMock.mockReset();
    fetchCurrentTeamSurveyMock.mockReset();
    fetchTeamChallengesMock.mockReset();
    fetchTeamThreadsMock.mockReset();
    fetchTeamSkillsMock.mockReset();
    reportTeamSkillProgressMock.mockReset();
    createThreadMock.mockReset();
    routerPushMock.mockReset();
    submitChallengeMock.mockReset();
  });

  it("shows a Norwegian loading state before auth resolves", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("prompts sign-in when the visitor is signed out, and never fetches", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("link", { name: /logg inn/i });
    expect(fetchTeamsOverviewMock).not.toHaveBeenCalled();
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("prompts sign-in when the server reports the overview call as unauthenticated", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "unauthenticated" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("link", { name: /logg inn/i });
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("shows a Norwegian generic error state on an overview read failure, never a fabricated team", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "read_failed" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("shows a 'none' relationship's real team name alongside the request-access action, and never calls the results endpoint", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Platform");
    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("treats a teamId absent from the overview as ambiguous, not a known denial: it calls the results endpoint and renders authorized results for an app admin with no membership document (e.g. a disabled team)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [] });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    render(<TeamDetail teamId="disabled-team" forumEnabled={true} />);

    expect(await screen.findByText("7 svar")).toBeTruthy();
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "disabled-team");
    expect(screen.queryByRole("button", { name: /be om tilgang/i })).toBeNull();
  });

  it("falls back to the non-sensitive denied/request-access state when the ambiguous absent-entry fallback is forbidden (non-admin, unrelated team)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [] });
    fetchTeamResultsMock.mockResolvedValue({ status: "forbidden" });

    render(<TeamDetail teamId="some-team" forumEnabled={true} />);

    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "some-team");
    expect(screen.queryByText(/\d+ svar/)).toBeNull();
    expect(screen.queryByText(/trend/i)).toBeNull();
  });

  it("renders the identical non-sensitive denied state for a genuinely nonexistent team as for a disabled/unrelated one", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [] });
    fetchTeamResultsMock.mockResolvedValue({ status: "forbidden" });

    render(<TeamDetail teamId="nonexistent-team" forumEnabled={true} />);

    const button = await screen.findByRole("button", { name: /be om tilgang/i });
    expect(button).toBeTruthy();
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "nonexistent-team");
  });

  it("shows a Norwegian pending state with no request-access action, and never calls the results endpoint", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_pending" }],
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText(/venter på godkjenning/i);
    expect(screen.getByText("Platform")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /be om tilgang/i })).toBeNull();
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("offers a request-access action for a rejected request, and never calls the results endpoint", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_rejected" }],
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("fetches and renders results for a member", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Platform");
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "team-1");
    expect(screen.getByText("7 svar")).toBeTruthy();
    // Matches TrendTable's own heading specifically — the plural
    // "undersøkelser" distinguishes it from PeriodSummary's singular
    // "Siste undersøkelse" heading.
    expect(screen.getByRole("heading", { name: /siste undersøkelser/i })).toBeTruthy();
    // The trend chart (TASK-012) renders alongside — not instead of — the
    // table above, sourced from the exact same already-fetched `results`
    // array: no second `fetchTeamResults` call. It is now code-split
    // (docs/features/performance-phase-a/SPEC.md — TASK-003), so its heading
    // only appears once the dynamically-imported module has resolved —
    // `findByRole` rather than `getByRole`.
    expect(await screen.findByRole("heading", { name: /trendvisualisering/i })).toBeTruthy();
    expect(fetchTeamResultsMock).toHaveBeenCalledTimes(1);
  });

  it("fetches and renders results for an app admin", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "admin" }],
    });
    fetchTeamResultsMock.mockResolvedValue(INSUFFICIENT_RESULTS);

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Platform");
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "team-1");
    await screen.findAllByText(/minst 5 personer har svart/i);
  });

  it("never renders a response count for an insufficient-data survey", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(INSUFFICIENT_RESULTS);

    const { container } = render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findAllByText(/minst 5 personer har svart/i);
    expect(container.textContent).not.toMatch(/\d+ svar/);
  });

  it("falls back to an access-required state if the results endpoint denies a caller the overview showed as a member (race)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue({ status: "forbidden" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(screen.queryByText(/trend/i)).toBeNull();
  });

  it("prompts sign-in if the results endpoint reports a revoked/invalid token", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue({ status: "unauthenticated" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("link", { name: /logg inn/i });
  });

  it("shows a Norwegian results-unavailable error, distinct from the page-level error, on a results read failure", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/teamets resultater/i);
    expect(screen.getByText("Platform")).toBeTruthy();
  });

  it("submits a request-access action via the existing TASK-005 gateway and refreshes to the resulting state", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
      })
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Platform", relationship: "request_pending" }],
      });
    requestTeamAccessMock.mockResolvedValue({ ok: true, outcome: "created" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    const button = await screen.findByRole("button", { name: /be om tilgang/i });
    await user.click(button);

    expect(requestTeamAccessMock).toHaveBeenCalledWith("a-token", "team-1");
    await screen.findByText(/venter på godkjenning/i);
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2);
  });

  it("shows a Norwegian inline error and leaves the action available when the request-access action fails", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });
    requestTeamAccessMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    const button = await screen.findByRole("button", { name: /be om tilgang/i });
    await user.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/deaktivert/i);
    expect(screen.getByRole("button", { name: /be om tilgang/i })).toBeTruthy();
  });

  it("never renders member/invitation/access-request identity data or raw encryption fields", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    const { container } = render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByText("Platform");

    expect(container.textContent).not.toMatch(/@|uid|invited|ciphertext|\biv\b|\btag\b/i);
  });

  it("unsubscribes from id token updates on unmount", () => {
    const unsubscribe = vi.fn();
    observeIdTokenMock.mockImplementation(() => unsubscribe);

    const { unmount } = render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("contains no leftover English copy", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByRole("button", { name: /be om tilgang/i });

    expect(screen.queryByText(/^sign in$/i)).toBeNull();
    expect(screen.queryByText(/^request access$/i)).toBeNull();
  });
});

describe("TeamDetail current-survey section (TASK-010)", () => {
  beforeEach(() => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(INSUFFICIENT_RESULTS);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
    fetchTeamResultsMock.mockReset();
    fetchCurrentTeamSurveyMock.mockReset();
    fetchTeamChallengesMock.mockReset();
    fetchTeamThreadsMock.mockReset();
    fetchTeamSkillsMock.mockReset();
    reportTeamSkillProgressMock.mockReset();
    createThreadMock.mockReset();
    routerPushMock.mockReset();
    submitChallengeMock.mockReset();
  });

  it("renders an open current survey with lifecycle/access-mode labels and a working /survey/{surveyId} link", async () => {
    fetchCurrentTeamSurveyMock.mockResolvedValue({
      status: "ok",
      survey: {
        surveyId: "survey-1",
        title: "Q3-puls",
        accessMode: "authenticated",
        lifecycle: "open",
      },
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Q3-puls");
    expect(screen.getByRole("heading", { name: /pågående undersøkelse/i })).toBeTruthy();
    expect(screen.getByText(/pågående · kun medlemmer av teamet/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /svar på undersøkelsen/i });
    expect(link.getAttribute("href")).toBe("/survey/survey-1");
    expect(fetchCurrentTeamSurveyMock).toHaveBeenCalledWith("a-token", "team-1");
  });

  it("renders a scheduled survey with its fallback title when none is set", async () => {
    fetchCurrentTeamSurveyMock.mockResolvedValue({
      status: "ok",
      survey: { surveyId: "survey-1", accessMode: "public", lifecycle: "scheduled" },
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Undersøkelse");
    expect(screen.getByText(/planlagt/i)).toBeTruthy();
    expect(screen.getByText(/alle med lenken/i)).toBeTruthy();
  });

  it("renders start/end dates when set", async () => {
    fetchCurrentTeamSurveyMock.mockResolvedValue({
      status: "ok",
      survey: {
        surveyId: "survey-1",
        accessMode: "public",
        lifecycle: "scheduled",
        startAt: "2026-08-01T00:00:00.000Z",
        endAt: "2026-10-01T00:00:00.000Z",
      },
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("link", { name: /svar på undersøkelsen/i });
    expect(screen.getByText(/start:/i)).toBeTruthy();
    expect(screen.getByText(/slutt:/i)).toBeTruthy();
  });

  it("shows the non-sensitive empty state when there is no current survey", async () => {
    fetchCurrentTeamSurveyMock.mockResolvedValue({ status: "ok", survey: null });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText(/ingen pågående undersøkelse/i);
    expect(screen.queryByRole("link", { name: /svar på undersøkelsen/i })).toBeNull();
  });

  it("shows a distinct section-level error, without hiding the rest of the page, on a current-survey read failure", async () => {
    fetchCurrentTeamSurveyMock.mockResolvedValue({ status: "read_failed" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Platform");
    expect(screen.getByRole("heading", { name: /pågående undersøkelse/i })).toBeTruthy();
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((alert) => /lasting av undersøkelsen/i.test(alert.textContent ?? ""))).toBe(true);
  });

  it("treats a forbidden/unauthenticated current-survey race as unavailable, never as a fabricated empty state", async () => {
    fetchCurrentTeamSurveyMock.mockResolvedValue({ status: "forbidden" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Platform");
    expect(screen.queryByText(/ingen pågående undersøkelse/i)).toBeNull();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("also renders the section alongside a results-unavailable error", async () => {
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });
    fetchCurrentTeamSurveyMock.mockResolvedValue({
      status: "ok",
      survey: { surveyId: "survey-1", accessMode: "public", lifecycle: "open" },
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("link", { name: /svar på undersøkelsen/i });
    expect(screen.getByText(/teamets resultater/i)).toBeTruthy();
  });

  it("never renders response count or result content in this section", async () => {
    fetchCurrentTeamSurveyMock.mockResolvedValue({
      status: "ok",
      survey: { surveyId: "survey-1", accessMode: "public", lifecycle: "open" },
    });

    const { container } = render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("link", { name: /svar på undersøkelsen/i });
    expect(container.textContent).not.toMatch(/\d+ svar/);
  });

  it("never queries the current-survey endpoint for a caller the overview already reports as denied", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(fetchCurrentTeamSurveyMock).not.toHaveBeenCalled();
  });

  it("contains no leftover English copy in the current-survey section", async () => {
    fetchCurrentTeamSurveyMock.mockResolvedValue({
      status: "ok",
      survey: { surveyId: "survey-1", accessMode: "public", lifecycle: "open" },
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("link", { name: /svar på undersøkelsen/i });
    expect(screen.queryByText(/^answer the survey$/i)).toBeNull();
    expect(screen.queryByText(/^no current survey$/i)).toBeNull();
  });
});

describe("TeamDetail current-survey section auth/route races (TASK-010)", () => {
  beforeEach(() => {
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
    fetchTeamResultsMock.mockReset();
    fetchCurrentTeamSurveyMock.mockReset();
    fetchTeamChallengesMock.mockReset();
    fetchTeamThreadsMock.mockReset();
    fetchTeamSkillsMock.mockReset();
    reportTeamSkillProgressMock.mockReset();
    createThreadMock.mockReset();
    routerPushMock.mockReset();
    submitChallengeMock.mockReset();
  });

  it("ignores a stale current-survey result that resolves after the user has signed out", async () => {
    const observer = capturingObserver();
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(INSUFFICIENT_RESULTS);
    const calls = queuedCalls(fetchCurrentTeamSurveyMock);

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchCurrentTeamSurveyMock).toHaveBeenCalledTimes(1));

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    calls.resolve(0, {
      status: "ok",
      survey: { surveyId: "survey-1", accessMode: "public", lifecycle: "open" },
    });
    await flushMicrotasks();

    expect(screen.queryByRole("link", { name: /svar på undersøkelsen/i })).toBeNull();
    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
  });

  it("ignores team A's stale current-survey result once the route has changed to team B", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team A", relationship: "member" },
        { teamId: "team-b", name: "Team B", relationship: "member" },
      ],
    });
    fetchTeamResultsMock.mockResolvedValue({
      status: "ok",
      teamId: "team-a",
      results: INSUFFICIENT_RESULTS.results,
    });
    let resolveTeamASurvey: (value: unknown) => void = () => {};
    fetchCurrentTeamSurveyMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTeamASurvey = resolve;
          }),
      )
      .mockResolvedValue({ status: "ok", survey: null });

    const { rerender } = render(<TeamDetail teamId="team-a" forumEnabled={true} />);
    await waitFor(() => expect(fetchCurrentTeamSurveyMock).toHaveBeenCalledWith("a-token", "team-a"));

    rerender(<TeamDetail teamId="team-b" forumEnabled={true} />);
    await screen.findByText("Team B");

    resolveTeamASurvey({
      status: "ok",
      survey: { surveyId: "team-a-survey", accessMode: "public", lifecycle: "open" },
    });
    await flushMicrotasks();

    expect(screen.queryByRole("link", { name: /svar på undersøkelsen/i })).toBeNull();
  });

  it("does not update state after unmount even if a pending current-survey fetch resolves later", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(INSUFFICIENT_RESULTS);
    const calls = queuedCalls(fetchCurrentTeamSurveyMock);

    const { unmount } = render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await waitFor(() => expect(fetchCurrentTeamSurveyMock).toHaveBeenCalledTimes(1));

    unmount();

    expect(() =>
      calls.resolve(0, {
        status: "ok",
        survey: { surveyId: "survey-1", accessMode: "public", lifecycle: "open" },
      }),
    ).not.toThrow();
    await flushMicrotasks();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("TeamDetail auth/route races", () => {
  beforeEach(() => {
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
    fetchTeamResultsMock.mockReset();
    fetchCurrentTeamSurveyMock.mockReset();
    fetchTeamChallengesMock.mockReset();
    fetchTeamThreadsMock.mockReset();
    fetchTeamSkillsMock.mockReset();
    reportTeamSkillProgressMock.mockReset();
    createThreadMock.mockReset();
    routerPushMock.mockReset();
    submitChallengeMock.mockReset();
  });

  it("ignores a stale overview result that resolves after the user has signed out", async () => {
    const observer = capturingObserver();
    const calls = queuedCalls(fetchTeamsOverviewMock);

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    calls.resolve(0, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });
    await flushMicrotasks();

    expect(screen.queryByText("Platform")).toBeNull();
    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
  });

  it("shows only account B's state when B's request resolves after A's request started (account switch)", async () => {
    const observer = capturingObserver();
    const calls = queuedCalls(fetchTeamsOverviewMock);

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    observer.emit("token-b");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2));

    calls.resolve(1, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });
    await screen.findByRole("button", { name: /be om tilgang/i });

    calls.resolve(0, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_pending" }],
    });
    await flushMicrotasks();

    expect(screen.queryByText(/venter på godkjenning/i)).toBeNull();
    expect(screen.getByRole("button", { name: /be om tilgang/i })).toBeTruthy();
  });

  it("ignores an older token-refresh result once a newer refresh has already started", async () => {
    const observer = capturingObserver();
    const calls = queuedCalls(fetchTeamsOverviewMock);

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    observer.emit("token-a1");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    observer.emit("token-a2");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2));

    calls.resolve(1, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_pending" }],
    });
    await screen.findByText(/venter på godkjenning/i);

    calls.resolve(0, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });
    await flushMicrotasks();

    expect(screen.getByText(/venter på godkjenning/i)).toBeTruthy();
  });

  it("ignores a post-request-access refresh result if the user signs out before it resolves", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    const calls = queuedCalls(fetchTeamsOverviewMock);
    requestTeamAccessMock.mockResolvedValue({ ok: true, outcome: "created" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    calls.resolve(0, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });
    const button = await screen.findByRole("button", { name: /be om tilgang/i });
    await user.click(button);

    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2));

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    calls.resolve(1, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_pending" }],
    });
    await flushMicrotasks();

    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
    expect(screen.queryByText(/venter på godkjenning/i)).toBeNull();
  });

  it("does not update state after unmount even if a pending overview fetch resolves later", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const observer = capturingObserver();
    const calls = queuedCalls(fetchTeamsOverviewMock);

    const { unmount } = render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    unmount();

    expect(() =>
      calls.resolve(0, {
        status: "ok",
        teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
      }),
    ).not.toThrow();
    await flushMicrotasks();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("ignores team A's stale result once the route has changed to team B", async () => {
    let resolveTeamA: (value: unknown) => void = () => {};
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTeamA = resolve;
          }),
      )
      .mockResolvedValue({
        status: "ok",
        teams: [{ teamId: "team-b", name: "Team B", relationship: "member" }],
      });
    fetchTeamResultsMock.mockResolvedValue({
      status: "ok",
      teamId: "team-b",
      results: INSUFFICIENT_RESULTS.results,
    });

    const { rerender } = render(<TeamDetail teamId="team-a" forumEnabled={true} />);
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    rerender(<TeamDetail teamId="team-b" forumEnabled={true} />);
    await screen.findByText("Team B");

    resolveTeamA({
      status: "ok",
      teams: [{ teamId: "team-a", name: "Team A", relationship: "none" }],
    });
    await flushMicrotasks();

    expect(screen.queryByText("Team A")).toBeNull();
    expect(screen.getByText("Team B")).toBeTruthy();
    expect(fetchTeamResultsMock).not.toHaveBeenCalledWith("a-token", "team-a");
  });

  it("ignores a late-resolving ambiguous-fallback results request for team A once the route has changed to team B", async () => {
    let resolveTeamAResults: (value: unknown) => void = () => {};
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    // Both team A and team B are absent from the overview (the ambiguous
    // case this fix introduced), so each load falls back to a results
    // request; only team A's is held open.
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [] });
    fetchTeamResultsMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTeamAResults = resolve;
          }),
      )
      .mockResolvedValue({
        status: "ok",
        teamId: "team-b",
        results: [
          { surveyId: "survey-35", date: "2026-08-24T00:00:00.000Z", minimumResponses: 5, status: "insufficient" },
        ],
      });

    const { rerender } = render(<TeamDetail teamId="team-a" forumEnabled={true} />);
    await waitFor(() => expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "team-a"));

    rerender(<TeamDetail teamId="team-b" forumEnabled={true} />);
    await screen.findAllByText(/minst 5 personer har svart/i);

    // Team A's fallback results request resolves late as fully authorized —
    // it must never be allowed to render on team B's now-current page.
    resolveTeamAResults(PUBLISHED_RESULTS);
    await flushMicrotasks();

    expect(screen.queryByText("7 svar")).toBeNull();
    expect(screen.getAllByText(/minst 5 personer har svart/i).length).toBeGreaterThan(0);
  });

  it("ignores a post-request-access refresh result if the account switches before it resolves", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    const calls = queuedCalls(fetchTeamsOverviewMock);
    requestTeamAccessMock.mockResolvedValue({ ok: true, outcome: "created" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    calls.resolve(0, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });
    const button = await screen.findByRole("button", { name: /be om tilgang/i });
    await user.click(button);
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2));

    observer.emit("token-b");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(3));

    calls.resolve(2, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_pending" }],
    });
    await screen.findByText(/venter på godkjenning/i);

    // Account A's stale post-request-access refresh resolves last.
    calls.resolve(1, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_rejected" }],
    });
    await flushMicrotasks();

    expect(screen.getByText(/venter på godkjenning/i)).toBeTruthy();
    expect(screen.queryByText(/ikke godkjent/i)).toBeNull();
  });
});

describe("TeamDetail challenges section (TASK-005)", () => {
  const OPEN_CHALLENGE = {
    challengeId: "c1",
    text: "Deploy process has no clear owner",
    status: "open",
    submittedAt: "2026-01-10",
  };
  const RESOLVED_CHALLENGE = {
    challengeId: "c2",
    text: "Code review regularly takes more than two days",
    status: "resolved",
    submittedAt: "2026-01-05",
  };

  beforeEach(() => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(INSUFFICIENT_RESULTS);
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
    fetchTeamResultsMock.mockReset();
    fetchCurrentTeamSurveyMock.mockReset();
    fetchTeamChallengesMock.mockReset();
    fetchTeamThreadsMock.mockReset();
    fetchTeamSkillsMock.mockReset();
    reportTeamSkillProgressMock.mockReset();
    createThreadMock.mockReset();
    routerPushMock.mockReset();
    submitChallengeMock.mockReset();
  });

  it("renders the section heading, submission panel, and open/resolved challenges for an authorized member", async () => {
    fetchTeamChallengesMock.mockResolvedValue({
      status: "ok",
      challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE],
      canSubmit: true,
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    expect(await screen.findByRole("heading", { name: "Utfordringer" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Meld en utfordring" })).toBeTruthy();
    expect(screen.getByText(OPEN_CHALLENGE.text)).toBeTruthy();
    expect(screen.getByText(RESOLVED_CHALLENGE.text)).toBeTruthy();
    expect(fetchTeamChallengesMock).toHaveBeenCalledWith("a-token", "team-1");
  });

  it("hides the submission panel, but keeps the read-only challenge list, for an app-admin-only viewer (no genuine team membership) — debug fix regression test", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "admin" }],
    });
    fetchTeamChallengesMock.mockResolvedValue({
      status: "ok",
      challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE],
      canSubmit: false,
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    expect(await screen.findByRole("heading", { name: "Utfordringer" })).toBeTruthy();
    expect(screen.getByText(OPEN_CHALLENGE.text)).toBeTruthy();
    expect(screen.getByText(RESOLVED_CHALLENGE.text)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Meld en utfordring" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Utfordring" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^send inn$/i })).toBeNull();
  });

  it("shows the submission panel for an app admin who is also a genuine team member", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "admin" }],
    });
    fetchTeamChallengesMock.mockResolvedValue({
      status: "ok",
      challenges: [OPEN_CHALLENGE],
      canSubmit: true,
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    expect(await screen.findByRole("heading", { name: "Meld en utfordring" })).toBeTruthy();
  });

  it("cannot submit a Challenge from the UI as an app-admin-only viewer, since no submission form is ever rendered", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "admin" }],
    });
    fetchTeamChallengesMock.mockResolvedValue({ status: "ok", challenges: [], canSubmit: false });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("heading", { name: "Utfordringer" });
    expect(screen.queryByRole("textbox", { name: "Utfordring" })).toBeNull();
    expect(submitChallengeMock).not.toHaveBeenCalled();
  });

  it("shows the Norwegian empty state when the team has no challenges", async () => {
    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("heading", { name: "Utfordringer" });
    expect(screen.getByText(/ingen utfordringer ennå/i)).toBeTruthy();
  });

  it("shows a distinct challenge-list error without hiding results/current survey (independent section failures)", async () => {
    fetchTeamChallengesMock.mockResolvedValue({ status: "read_failed" });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("7 svar");
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((alert) => /lasting av utfordringer/i.test(alert.textContent ?? ""))).toBe(true);
  });

  it("keeps the challenges section on a results read failure (results_unavailable branch)", async () => {
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });
    fetchTeamChallengesMock.mockResolvedValue({ status: "ok", challenges: [OPEN_CHALLENGE], canSubmit: true });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText(/teamets resultater/i);
    expect(screen.getByText(OPEN_CHALLENGE.text)).toBeTruthy();
  });

  it("keeps the challenges section on a current-survey read failure", async () => {
    fetchCurrentTeamSurveyMock.mockResolvedValue({ status: "read_failed" });
    fetchTeamChallengesMock.mockResolvedValue({ status: "ok", challenges: [OPEN_CHALLENGE], canSubmit: true });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText(OPEN_CHALLENGE.text);
    expect(screen.getByRole("heading", { name: /pågående undersøkelse/i })).toBeTruthy();
  });

  it("never fetches challenges for a caller the overview already reports as denied", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(fetchTeamChallengesMock).not.toHaveBeenCalled();
  });

  it("submits a challenge and refreshes the list through the existing server contract, without fabricating a DTO", async () => {
    const user = userEvent.setup();
    fetchTeamChallengesMock
      .mockResolvedValueOnce(NO_CHALLENGES)
      .mockResolvedValueOnce({ status: "ok", challenges: [OPEN_CHALLENGE], canSubmit: true });
    submitChallengeMock.mockResolvedValue({ status: "ok" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByRole("heading", { name: "Meld en utfordring" });
    expect(screen.getByText(/ingen utfordringer ennå/i)).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Utfordring" }), "Deploy process has no clear owner");
    await user.click(screen.getByRole("button", { name: /^send inn$/i }));

    await screen.findByText(/registrert/i);
    expect(submitChallengeMock).toHaveBeenCalledWith("a-token", "team-1", "Deploy process has no clear owner");

    await screen.findByText(OPEN_CHALLENGE.text);
    expect(fetchTeamChallengesMock).toHaveBeenCalledTimes(2);
  });

  it("discards a stale post-submission challenge-list refresh once the caller has signed out before it resolves", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    submitChallengeMock.mockResolvedValue({ status: "ok" });
    let resolveRefresh: (value: unknown) => void = () => {};
    fetchTeamChallengesMock
      .mockResolvedValueOnce(NO_CHALLENGES)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    observer.emit("a-token");
    await screen.findByRole("heading", { name: "Meld en utfordring" });

    await user.type(screen.getByRole("textbox", { name: "Utfordring" }), "Deploy process has no clear owner");
    await user.click(screen.getByRole("button", { name: /^send inn$/i }));
    await screen.findByText(/registrert/i);

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    resolveRefresh({ status: "ok", challenges: [OPEN_CHALLENGE], canSubmit: true });
    await flushMicrotasks();

    expect(screen.queryByText(OPEN_CHALLENGE.text)).toBeNull();
    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
  });

  it("discards a stale post-submission challenge-list refresh once the route has changed to a different team", async () => {
    const user = userEvent.setup();
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team A", relationship: "member" },
        { teamId: "team-b", name: "Team B", relationship: "member" },
      ],
    });
    fetchTeamResultsMock.mockResolvedValue({ status: "ok", teamId: "team-a", results: INSUFFICIENT_RESULTS.results });
    submitChallengeMock.mockResolvedValue({ status: "ok" });
    let resolveRefresh: (value: unknown) => void = () => {};
    fetchTeamChallengesMock
      .mockResolvedValueOnce(NO_CHALLENGES)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      )
      .mockResolvedValue(NO_CHALLENGES);

    const { rerender } = render(<TeamDetail teamId="team-a" forumEnabled={true} />);
    await screen.findByRole("heading", { name: "Meld en utfordring" });

    await user.type(screen.getByRole("textbox", { name: "Utfordring" }), "Deploy process has no clear owner");
    await user.click(screen.getByRole("button", { name: /^send inn$/i }));
    await screen.findByText(/registrert/i);

    rerender(<TeamDetail teamId="team-b" forumEnabled={true} />);
    await screen.findByText("Team B");

    resolveRefresh({ status: "ok", challenges: [OPEN_CHALLENGE], canSubmit: true });
    await flushMicrotasks();

    expect(screen.queryByText(OPEN_CHALLENGE.text)).toBeNull();
  });

  it("never renders an identity-shaped value (uid/email/resolvedBy/archivedBy) anywhere on the page", async () => {
    fetchTeamChallengesMock.mockResolvedValue({
      status: "ok",
      challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE],
      canSubmit: true,
    });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    const { container } = render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByText(OPEN_CHALLENGE.text);

    expect(container.textContent).not.toMatch(/@|uid|resolvedBy|archivedBy|ciphertext|\biv\b|\btag\b/i);
  });

  it("contains no leftover English copy in the challenges section", async () => {
    fetchTeamChallengesMock.mockResolvedValue({
      status: "ok",
      challenges: [OPEN_CHALLENGE],
      canSubmit: true,
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText(OPEN_CHALLENGE.text);
    expect(screen.queryByText(/^report a challenge$/i)).toBeNull();
    expect(screen.queryByText(/^no challenges yet$/i)).toBeNull();
    expect(screen.queryByText(/^submit$/i)).toBeNull();
  });
});

describe("TeamDetail forum section (TASK-005)", () => {
  const THREAD_1 = {
    threadId: "thread-1",
    title: "Har noen løst dette?",
    authorTag: "48D73D",
    isOwnThread: false,
    createdAt: "2026-01-10T10:00:00.000Z",
  };

  beforeEach(() => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(INSUFFICIENT_RESULTS);
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
    fetchTeamResultsMock.mockReset();
    fetchCurrentTeamSurveyMock.mockReset();
    fetchTeamChallengesMock.mockReset();
    submitChallengeMock.mockReset();
    fetchTeamThreadsMock.mockReset();
    fetchTeamSkillsMock.mockReset();
    reportTeamSkillProgressMock.mockReset();
    createThreadMock.mockReset();
    routerPushMock.mockReset();
  });

  it("renders the section heading, create-thread form, and existing threads for an authorized member", async () => {
    fetchTeamThreadsMock.mockResolvedValue({ status: "ok", threads: [THREAD_1] });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    expect(await screen.findByRole("heading", { name: "Forum" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Start en ny tråd" })).toBeTruthy();
    expect(screen.getByText(THREAD_1.title)).toBeTruthy();
    expect(fetchTeamThreadsMock).toHaveBeenCalledWith("a-token", "team-1");
  });

  it("shows the Norwegian empty state when the team has no threads", async () => {
    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("heading", { name: "Forum" });
    expect(screen.getByText(/ingen tråder ennå/i)).toBeTruthy();
  });

  it("shows a distinct forum error without hiding results/challenges (independent section failures)", async () => {
    fetchTeamThreadsMock.mockResolvedValue({ status: "read_failed" });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);
    fetchTeamChallengesMock.mockResolvedValue({ status: "ok", challenges: [] });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("7 svar");
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((alert) => /lasting av forumet/i.test(alert.textContent ?? ""))).toBe(true);
  });

  it("keeps the forum section on a results read failure (results_unavailable branch)", async () => {
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });
    fetchTeamThreadsMock.mockResolvedValue({ status: "ok", threads: [THREAD_1] });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText(/teamets resultater/i);
    expect(screen.getByText(THREAD_1.title)).toBeTruthy();
  });

  it("never fetches threads for a caller the overview already reports as denied", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(fetchTeamThreadsMock).not.toHaveBeenCalled();
  });

  it("creates a thread and navigates to its detail view, without fabricating a DTO", async () => {
    const user = userEvent.setup();
    createThreadMock.mockResolvedValue({ status: "ok", threadId: "thread-9" });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByRole("heading", { name: "Start en ny tråd" });

    await user.type(screen.getByLabelText("Tittel"), "En helt ny tråd");
    await user.type(screen.getByLabelText("Innhold"), "Med et gyldig innhold i tråden.");
    await user.click(screen.getByRole("button", { name: /^opprett tråd$/i }));

    await screen.findByText(/tråden ble opprettet/i);
    expect(createThreadMock).toHaveBeenCalledWith(
      "a-token",
      "team-1",
      "En helt ny tråd",
      "Med et gyldig innhold i tråden.",
    );
    expect(routerPushMock).toHaveBeenCalledWith("/teams/team-1/forum/thread-9");
  });

  it("discards a stale post-create navigation once the caller has signed out before it resolves", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    let resolveCreate: (value: unknown) => void = () => {};
    createThreadMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    observer.emit("a-token");
    await screen.findByRole("heading", { name: "Start en ny tråd" });

    await user.type(screen.getByLabelText("Tittel"), "En helt ny tråd");
    await user.type(screen.getByLabelText("Innhold"), "Med et gyldig innhold i tråden.");
    await user.click(screen.getByRole("button", { name: /^opprett tråd$/i }));

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    resolveCreate({ status: "ok", threadId: "thread-9" });
    await flushMicrotasks();

    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("discards a stale post-create navigation once the route has changed to a different team", async () => {
    const user = userEvent.setup();
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team A", relationship: "member" },
        { teamId: "team-b", name: "Team B", relationship: "member" },
      ],
    });
    fetchTeamResultsMock.mockResolvedValue({
      status: "ok",
      teamId: "team-a",
      results: INSUFFICIENT_RESULTS.results,
    });
    let resolveCreate: (value: unknown) => void = () => {};
    createThreadMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const { rerender } = render(<TeamDetail teamId="team-a" forumEnabled={true} />);
    await screen.findByRole("heading", { name: "Start en ny tråd" });

    await user.type(screen.getByLabelText("Tittel"), "En helt ny tråd");
    await user.type(screen.getByLabelText("Innhold"), "Med et gyldig innhold i tråden.");
    await user.click(screen.getByRole("button", { name: /^opprett tråd$/i }));

    rerender(<TeamDetail teamId="team-b" forumEnabled={true} />);
    await screen.findByText("Team B");

    resolveCreate({ status: "ok", threadId: "thread-9" });
    await flushMicrotasks();

    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("never renders an identity-shaped value (authorUid/ciphertext/deletedBy) anywhere on the page", async () => {
    fetchTeamThreadsMock.mockResolvedValue({ status: "ok", threads: [THREAD_1] });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    const { container } = render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByText(THREAD_1.title);

    expect(container.textContent).not.toMatch(/authorUid|ciphertext|deletedBy|\bkeyVersion\b/i);
  });

  it("contains no leftover English copy in the forum section", async () => {
    fetchTeamThreadsMock.mockResolvedValue({ status: "ok", threads: [THREAD_1] });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText(THREAD_1.title);
    expect(screen.queryByText(/^start a new thread$/i)).toBeNull();
    expect(screen.queryByText(/^no threads yet$/i)).toBeNull();
  });
});

describe("TeamDetail forum feature flag (FEATURE_FORUM_ENABLED)", () => {
  const THREAD_1 = {
    threadId: "thread-1",
    title: "Har noen løst dette?",
    authorTag: "48D73D",
    isOwnThread: false,
    createdAt: "2026-01-10T10:00:00.000Z",
  };

  beforeEach(() => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(INSUFFICIENT_RESULTS);
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue({ status: "ok", threads: [THREAD_1] });
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
    fetchTeamResultsMock.mockReset();
    fetchCurrentTeamSurveyMock.mockReset();
    fetchTeamChallengesMock.mockReset();
    fetchTeamThreadsMock.mockReset();
    fetchTeamSkillsMock.mockReset();
    reportTeamSkillProgressMock.mockReset();
    createThreadMock.mockReset();
    routerPushMock.mockReset();
  });

  it("renders no Forum heading, create-thread form, or thread list when the flag is disabled (authorized branch)", async () => {
    render(<TeamDetail teamId="team-1" forumEnabled={false} />);

    await screen.findByText("Platform");
    expect(screen.queryByRole("heading", { name: "Forum" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Start en ny tråd" })).toBeNull();
    expect(screen.queryByText(THREAD_1.title)).toBeNull();
  });

  it("never fetches the team's threads when the flag is disabled (authorized branch)", async () => {
    render(<TeamDetail teamId="team-1" forumEnabled={false} />);

    await screen.findByText("Platform");
    expect(fetchTeamThreadsMock).not.toHaveBeenCalled();
  });

  it("renders no Forum section, and never fetches threads, when the flag is disabled (results_unavailable branch)", async () => {
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });

    render(<TeamDetail teamId="team-1" forumEnabled={false} />);

    await screen.findByText(/teamets resultater/i);
    expect(screen.queryByRole("heading", { name: "Forum" })).toBeNull();
    expect(fetchTeamThreadsMock).not.toHaveBeenCalled();
  });

  it("shows no Forum-related loading or error state while the flag is disabled", async () => {
    fetchTeamThreadsMock.mockResolvedValue({ status: "read_failed" });

    render(<TeamDetail teamId="team-1" forumEnabled={false} />);

    await screen.findByText("Platform");
    const alerts = screen.queryAllByRole("alert");
    expect(alerts.some((alert) => /lasting av forumet/i.test(alert.textContent ?? ""))).toBe(false);
  });

  it("renders the Forum section and fetches threads exactly as before when the flag is enabled", async () => {
    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    expect(await screen.findByRole("heading", { name: "Forum" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Start en ny tråd" })).toBeTruthy();
    expect(screen.getByText(THREAD_1.title)).toBeTruthy();
    expect(fetchTeamThreadsMock).toHaveBeenCalledWith("a-token", "team-1");
  });
});

describe("TeamDetail skill section (TASK-007, extended by TASK-002)", () => {
  const TRACKED_SKILL = {
    treeId: "tree-1",
    name: "Containers",
    nodes: [
      { nodeId: "node-0", label: "Fundamentals", order: 0 },
      { nodeId: "node-1", label: "Pilot", order: 1 },
    ],
    currentNodeId: "node-0",
  };

  const NOT_STARTED_SKILL = {
    treeId: "tree-2",
    name: "Observability",
    nodes: [{ nodeId: "node-0", label: "Basic logging", order: 0 }],
    currentNodeId: null,
  };

  beforeEach(() => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(INSUFFICIENT_RESULTS);
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
    fetchTeamResultsMock.mockReset();
    fetchCurrentTeamSurveyMock.mockReset();
    fetchTeamChallengesMock.mockReset();
    submitChallengeMock.mockReset();
    fetchTeamThreadsMock.mockReset();
    createThreadMock.mockReset();
    fetchTeamSkillsMock.mockReset();
    reportTeamSkillProgressMock.mockReset();
    routerPushMock.mockReset();
  });

  it("renders the section heading and every tracked tree's full ordered stage list for an authorized member", async () => {
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: true });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    expect(await screen.findByRole("heading", { name: "Kompetanseområder" })).toBeTruthy();
    expect(screen.getByText("Containers")).toBeTruthy();
    expect(screen.getByText("Fundamentals", { selector: "li" })).toBeTruthy();
    expect(screen.getByText("Pilot", { selector: "li" })).toBeTruthy();
    expect(fetchTeamSkillsMock).toHaveBeenCalledWith("a-token", "team-1");
  });

  it("shows the Norwegian empty state when the team tracks no SkillTree", async () => {
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("heading", { name: "Kompetanseområder" });
    expect(screen.getByText(/sporer ingen kompetanseområder/i)).toBeTruthy();
  });

  it("represents a currentNodeId of null with a distinct 'not started' state", async () => {
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [NOT_STARTED_SKILL], canReportProgress: true });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Observability");
    expect(screen.getByText(/ikke startet/i)).toBeTruthy();
  });

  it("marks the current stage with visible text, never color alone", async () => {
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: true });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Containers");
    expect(screen.getByText(/nåværende steg/i)).toBeTruthy();
  });

  it("shows a distinct skill-section error without hiding results/challenges/forum (independent section failures)", async () => {
    fetchTeamSkillsMock.mockResolvedValue({ status: "read_failed" });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);
    fetchTeamChallengesMock.mockResolvedValue({ status: "ok", challenges: [] });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("7 svar");
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((alert) => /lasting av kompetanseområder/i.test(alert.textContent ?? ""))).toBe(true);
  });

  it("keeps the skill section on a results read failure (results_unavailable branch)", async () => {
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: true });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText(/teamets resultater/i);
    expect(screen.getByText("Containers")).toBeTruthy();
  });

  it("never fetches skills for a caller the overview already reports as denied", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(fetchTeamSkillsMock).not.toHaveBeenCalled();
  });

  it("renders a member self-report control (stage select + save button) alongside the read-only list (TASK-002, BR-10)", async () => {
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: true });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Containers");
    expect(screen.queryByRole("button", { name: /start sporing|stopp sporing/i })).toBeNull();
    expect(screen.getByRole("combobox", { name: /sett stadium/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /lagre/i })).toBeTruthy();
  });

  it("reports a stage via the gateway and refreshes the skill section through the existing GET path, without fabricating a DTO", async () => {
    const user = userEvent.setup();
    fetchTeamSkillsMock
      .mockResolvedValueOnce({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: true })
      .mockResolvedValueOnce({
        status: "ok",
        skills: [{ ...TRACKED_SKILL, currentNodeId: "node-1" }],
        canReportProgress: true,
      });
    reportTeamSkillProgressMock.mockResolvedValue({ ok: true });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByText("Containers");

    await user.selectOptions(screen.getByRole("combobox", { name: /sett stadium/i }), "node-1");
    await user.click(screen.getByRole("button", { name: /lagre/i }));

    await waitFor(() => expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(2));
    expect(reportTeamSkillProgressMock).toHaveBeenCalledWith("a-token", "team-1", "tree-1", "node-1");
    await screen.findByText("Pilot", { selector: "li[aria-current='step']" });
  });

  it("discards a stale post-report skill refresh once the route has changed to a different team", async () => {
    const user = userEvent.setup();
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team A", relationship: "member" },
        { teamId: "team-b", name: "Team B", relationship: "member" },
      ],
    });
    fetchTeamResultsMock.mockResolvedValue({ status: "ok", teamId: "team-a", results: INSUFFICIENT_RESULTS.results });
    reportTeamSkillProgressMock.mockResolvedValue({ ok: true });
    let resolveRefresh: (value: unknown) => void = () => {};
    fetchTeamSkillsMock
      .mockResolvedValueOnce({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: true })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      )
      .mockResolvedValue(NO_SKILLS);

    const { rerender } = render(<TeamDetail teamId="team-a" forumEnabled={true} />);
    await screen.findByText("Containers");

    await user.selectOptions(screen.getByRole("combobox", { name: /sett stadium/i }), "node-1");
    await user.click(screen.getByRole("button", { name: /lagre/i }));
    await waitFor(() => expect(reportTeamSkillProgressMock).toHaveBeenCalledTimes(1));

    rerender(<TeamDetail teamId="team-b" forumEnabled={true} />);
    await screen.findByText("Team B");

    resolveRefresh({
      status: "ok",
      skills: [{ ...TRACKED_SKILL, currentNodeId: "node-1" }],
      canReportProgress: true,
    });
    await flushMicrotasks();

    expect(screen.queryByText("Containers")).toBeNull();
  });

  it("preserves canReportProgress from the refreshed GET after a successful report — the post-refresh capability is never carried over from the pre-report state", async () => {
    const user = userEvent.setup();
    fetchTeamSkillsMock
      .mockResolvedValueOnce({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: true })
      .mockResolvedValueOnce({
        status: "ok",
        skills: [{ ...TRACKED_SKILL, currentNodeId: "node-1" }],
        canReportProgress: false,
      });
    reportTeamSkillProgressMock.mockResolvedValue({ ok: true });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByText("Containers");
    expect(screen.getByRole("combobox", { name: /sett stadium/i })).toBeTruthy();

    await user.selectOptions(screen.getByRole("combobox", { name: /sett stadium/i }), "node-1");
    await user.click(screen.getByRole("button", { name: /lagre/i }));

    await waitFor(() => expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(2));
    await screen.findByText("Pilot", { selector: "li[aria-current='step']" });
    expect(screen.queryByRole("combobox", { name: /sett stadium/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /lagre/i })).toBeNull();
  });

  it("hides the stage-select/Lagre mutation control for an app-admin-only viewer (canReportProgress: false), while the read-only stage list remains visible (permission-UI correction)", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "admin" }],
    });
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: false });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByText("Containers");

    expect(screen.getByText("Fundamentals", { selector: "li" })).toBeTruthy();
    expect(screen.getByText("Pilot", { selector: "li" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /sett stadium/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /lagre/i })).toBeNull();
    expect(reportTeamSkillProgressMock).not.toHaveBeenCalled();
  });

  it("hides the stage-select/Lagre mutation control for a member of a disabled team (canReportProgress: false), while the read-only stage list remains visible (permission-UI correction)", async () => {
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: false });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByText("Containers");

    expect(screen.getByText("Fundamentals", { selector: "li[aria-current='step']" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /sett stadium/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /lagre/i })).toBeNull();
  });

  it("renders the selector and 'Lagre' for an app admin who is also a genuine team member (canReportProgress: true)", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "admin" }],
    });
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: true });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByText("Containers");

    expect(screen.getByRole("combobox", { name: /sett stadium/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /lagre/i })).toBeTruthy();
  });

  it("never renders member/admin identity data in the skill section", async () => {
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [TRACKED_SKILL], canReportProgress: true });

    const { container } = render(<TeamDetail teamId="team-1" forumEnabled={true} />);
    await screen.findByText("Containers");

    expect(container.textContent).not.toMatch(/@|uid|createdBy|updatedBy/i);
  });

  it("renders untrusted-looking SkillTree name/label content as plain text, never HTML injection", async () => {
    const maliciousSkill = {
      treeId: "tree-3",
      name: "<img src=x onerror=alert(1)>Evil Tree",
      nodes: [{ nodeId: "node-0", label: "<script>alert('xss')</script>Stage", order: 0 }],
      currentNodeId: "node-0",
    };
    fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [maliciousSkill], canReportProgress: true });

    const { container } = render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText(maliciousSkill.name);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});

/**
 * `TrendChart` is code-split via `next/dynamic` and wrapped in a chart-local
 * `catchError` boundary (docs/features/performance-phase-a/SPEC.md —
 * TASK-003, BR-13 through BR-18). Most other tests above already exercise
 * the real, unmocked `TrendChart` module end-to-end (e.g. "fetches and
 * renders results for a member") — this block covers the parent-level
 * behavior TASK-003 adds: the empty-results skip gate, the chart-local
 * loading fallback, and chart-local failure isolation.
 */
describe("TeamDetail lazy TrendChart (TASK-003)", () => {
  beforeEach(() => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
    // Restores next/dynamic's real implementation for later tests — only
    // the module-load-failure test below narrowly mocks it.
    vi.doUnmock("next/dynamic");
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    fetchTeamResultsMock.mockReset();
    fetchCurrentTeamSurveyMock.mockReset();
    fetchTeamChallengesMock.mockReset();
    fetchTeamThreadsMock.mockReset();
    fetchTeamSkillsMock.mockReset();
  });

  it("renders no chart region and no chart-local loading state when there are no results to chart (BR-15)", async () => {
    fetchTeamResultsMock.mockResolvedValue({ status: "ok", teamId: "team-1", results: [] });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Platform");
    expect(screen.queryByRole("heading", { name: /trendvisualisering/i })).toBeNull();
    expect(screen.queryByText(/laster trendvisualisering/i)).toBeNull();

    // Give any stray async work a chance to settle, then re-confirm nothing
    // appeared afterward either — never merely a synchronous snapshot.
    await flushMicrotasks();
    expect(screen.queryByRole("heading", { name: /trendvisualisering/i })).toBeNull();
    expect(screen.queryByText(/laster trendvisualisering/i)).toBeNull();
  });

  it("does not increase TrendChart module-load invocations when there are no results to chart (BR-15)", async () => {
    const callsBefore = trendChartModuleLoadedMock.mock.calls.length;
    fetchTeamResultsMock.mockResolvedValue({ status: "ok", teamId: "team-1", results: [] });

    render(<TeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Platform");
    await flushMicrotasks();

    expect(trendChartModuleLoadedMock.mock.calls.length).toBe(callsBefore);
  });

  it("shows the chart-local LoadingState while the chart module is pending, without hiding surrounding sections (BR-16)", async () => {
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);
    const gate = deferredPromise<void>();

    vi.resetModules();
    vi.doMock("../../results/components/TrendChart", async (importOriginal) => {
      await gate.promise;
      return importOriginal();
    });
    const { TeamDetail: FreshTeamDetail } = await import("./TeamDetail");

    render(<FreshTeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Platform");
    // Surrounding sections (the table above the chart) are already rendered,
    // independent of the still-pending chart module.
    expect(screen.getByRole("heading", { name: /siste undersøkelser/i })).toBeTruthy();
    expect(await screen.findByText(/laster trendvisualisering/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /trendvisualisering/i })).toBeNull();

    gate.resolve();

    expect(await screen.findByRole("heading", { name: /trendvisualisering/i })).toBeTruthy();
    expect(screen.queryByText(/laster trendvisualisering/i)).toBeNull();
  });

  it("isolates a chart module-load failure to the chart's own section, leaving every sibling section rendered (BR-18)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);
    fetchTeamChallengesMock.mockResolvedValue({
      status: "ok",
      challenges: [{ challengeId: "c1", text: "Deploy process has no clear owner", status: "open", submittedAt: "2026-01-10" }],
    });

    vi.resetModules();
    vi.doMock("../../results/components/TrendChart", () => {
      throw new Error("simulated chunk-load failure");
    });
    // `next/dynamic` is documented as "a composite of React.lazy() and
    // Suspense" (verified against the installed Next.js docs/types — SPEC →
    // AD-6). Under jsdom/Vitest (no live Next.js App Router runtime),
    // `next/dynamic`'s own internal wrapping does not reliably surface a
    // rejected loader promise the way it does in a real Next.js render —
    // this substitutes its documented, first-party-equivalent composition
    // so the module-load rejection this test forces propagates
    // deterministically. It changes none of `TeamDetail.tsx`'s production
    // code: the real loader function and the real `catchError` boundary
    // from `TeamDetail.tsx` are exercised unmodified — only `next/dynamic`'s
    // own internal wiring is substituted, and only for this one test.
    // `next/dynamic` itself is exercised for real by every other test in
    // this file (e.g. the "fetches and renders results for a member" and
    // loading-state tests above), and again by `pnpm build`.
    vi.doMock("next/dynamic", () => ({
      default: (loader: () => Promise<ComponentType<unknown>>, options: { loading?: () => ReactNode }) => {
        const Lazy = lazy(() => loader().then((Component) => ({ default: Component })));
        return function DynamicStub(props: object) {
          return (
            <Suspense fallback={options?.loading ? options.loading() : null}>
              <Lazy {...props} />
            </Suspense>
          );
        };
      },
    }));
    const { TeamDetail: FreshTeamDetail } = await import("./TeamDetail");

    render(<FreshTeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Platform");
    const fallback = await screen.findByText(/trendvisualiseringen kunne ikke lastes/i);
    expect(fallback.getAttribute("role")).toBe("alert");

    // No sensitive/internal exception detail is ever shown.
    expect(document.body.textContent).not.toMatch(/simulated chunk-load failure/);

    // Every sibling section remains rendered — never a page-level failure.
    expect(screen.queryByText(teamsCopy.detail.error)).toBeNull();
    expect(screen.getByText("7 svar")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /siste undersøkelser/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Utfordringer" })).toBeTruthy();
    expect(screen.getByText("Deploy process has no clear owner")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Forum" })).toBeTruthy();

    // The boundary triggers no data fetching of its own.
    expect(fetchTeamResultsMock).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it("isolates a chart render failure (once the module has loaded) to the chart's own section, leaving every sibling section rendered (BR-18)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    vi.resetModules();
    vi.doMock("../../results/components/TrendChart", () => ({
      TrendChart: () => {
        throw new Error("simulated render failure");
      },
    }));
    const { TeamDetail: FreshTeamDetail } = await import("./TeamDetail");

    render(<FreshTeamDetail teamId="team-1" forumEnabled={true} />);

    await screen.findByText("Platform");
    const fallback = await screen.findByText(/trendvisualiseringen kunne ikke lastes/i);
    expect(fallback.getAttribute("role")).toBe("alert");
    expect(document.body.textContent).not.toMatch(/simulated render failure/);

    expect(screen.queryByText(teamsCopy.detail.error)).toBeNull();
    expect(screen.getByText("7 svar")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /siste undersøkelser/i })).toBeTruthy();
    expect(fetchTeamResultsMock).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });
});

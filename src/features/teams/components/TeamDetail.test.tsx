// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectNamedControls } from "../../../components/ui/heading-structure";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const fetchTeamRosterMock = vi.fn();
const fetchSkillNeedsMock = vi.fn();
const fetchSkillContributionMock = vi.fn();
const fetchRoadmapItemsMock = vi.fn().mockResolvedValue({
  status: "ok",
  items: [],
  canEdit: false,
  truncated: false,
});

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

vi.mock("../client/team-visibility-gateway", () => ({
  // Pending: the visibility panel stays in its loading state and does not compete with the component under test.
  fetchTeamVisibility: () => new Promise(() => {}),
  saveTeamVisibility: vi.fn(),
  fetchPublicTeam: vi.fn(),
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

vi.mock("../../team-skills/client/team-skills-gateway", () => ({
  fetchSkillCoverage: vi.fn(() => new Promise(() => {})),
  fetchSkillNeeds: fetchSkillNeedsMock,
  fetchSkillContribution: fetchSkillContributionMock,
  optInSkillContribution: vi.fn(),
  withdrawSkillContribution: vi.fn(),
}));

vi.mock("../client/team-roster-gateway", () => ({
  fetchTeamRoster: fetchTeamRosterMock,
}));

vi.mock("../../roadmap/client/roadmap-gateway", () => ({
  fetchRoadmapItems: fetchRoadmapItemsMock,
}));

vi.mock("../../results/components/TrendChart", async (importOriginal) => {
  trendChartModuleLoadedMock();
  return importOriginal<typeof import("../../results/components/TrendChart")>();
});

const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  usePathname: () => "/teams/team-1",
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
  // Every mounted 'useAuthGatedResource' subscribes (TeamDetail and its children such as
  // TeamPageHeader), and Firebase notifies all of them: emit must reach every listener.
  const callbacks = new Set<(token: string | null) => void>();
  observeIdTokenMock.mockImplementation((cb: (token: string | null) => void) => {
    callbacks.add(cb);
    return () => {
      callbacks.delete(cb);
    };
  });
  return {
    emit(token: string | null) {
      for (const cb of [...callbacks]) {
        cb(token);
      }
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
    fetchTeamRosterMock.mockReset();
    fetchSkillNeedsMock.mockReset();
    fetchSkillContributionMock.mockReset();
    fetchSkillNeedsMock.mockReturnValue(new Promise(() => {}));
    fetchSkillContributionMock.mockReturnValue(new Promise(() => {}));
    // Pending by default: the needs section is covered by its own tests, and its empty-state copy would collide with unrelated loose text queries here.
    fetchSkillNeedsMock.mockReturnValue(new Promise(() => {}));
  });

  it("shows a Norwegian loading state before auth resolves", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<TeamDetail teamId="team-1" />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("prompts sign-in when the visitor is signed out, and never fetches", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<TeamDetail teamId="team-1" />);

    await screen.findByRole("link", { name: /logg inn/i });
    expect(fetchTeamsOverviewMock).not.toHaveBeenCalled();
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("prompts sign-in when the server reports the overview call as unauthenticated", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "unauthenticated" });

    render(<TeamDetail teamId="team-1" />);

    await screen.findByRole("link", { name: /logg inn/i });
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  describe("team route navigation and roadmap link (team-roadmap BR-2, BR-3)", () => {
    function mockAuthorized(resultsStatus: "ok" | "read_failed") {
      observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
      fetchTeamsOverviewMock.mockResolvedValue({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
      });
      fetchTeamResultsMock.mockResolvedValue(
        resultsStatus === "ok" ? INSUFFICIENT_RESULTS : { status: "read_failed" },
      );
      fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
      fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
      fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
      fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
    }

    it.each(["ok", "read_failed"] as const)(
      "renders the five team tabs navigation plus 'Se roadmap' in the %s branch",
      async (resultsStatus) => {
        mockAuthorized(resultsStatus);

        render(<TeamDetail teamId="team-1" />);

        const nav = await screen.findByRole("navigation", { name: teamsCopy.nav.label });
        const links = within(nav).getAllByRole("link");
        expect(links.map((link) => link.getAttribute("href"))).toEqual([
          "/teams/team-1",
          "/teams/team-1/roadmap",
          "/teams/team-1/competence-plan",
          "/teams/team-1/competence",
          "/teams/team-1/systems",
        ]);
        // The roadmap link now lives on the Teamkompetanse/Roadmap sub-pages, not on the overview.
        expect(screen.queryByRole("link", { name: "Se roadmap" })).toBeNull();
      },
    );

    it("does not render the navigation or 'Se roadmap' in the access-denied/request state", async () => {
      observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
      fetchTeamsOverviewMock.mockResolvedValue({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
      });

      render(<TeamDetail teamId="team-1" />);

      await screen.findByRole("button", { name: /be om tilgang/i });
      expect(screen.queryByRole("navigation", { name: teamsCopy.nav.label })).toBeNull();
      expect(screen.queryByRole("link", { name: "Se roadmap" })).toBeNull();
    });

    it("keeps the same navigation with the forum flag off", async () => {
      mockAuthorized("ok");

      render(<TeamDetail teamId="team-1" />);

      const nav = await screen.findByRole("navigation", { name: teamsCopy.nav.label });
      expect(within(nav).getAllByRole("link")).toHaveLength(5);
    });
  });

  it("shows a Norwegian generic error state on an overview read failure, never a fabricated team", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "read_failed" });

    render(<TeamDetail teamId="team-1" />);

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

    render(<TeamDetail teamId="team-1" />);

    await screen.findByText("Platform");
    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("treats a teamId absent from the overview as ambiguous, not a known denial: it calls the results endpoint and renders authorized results for an app admin with no membership document (e.g. a disabled team)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [] });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    render(<TeamDetail teamId="disabled-team" />);

    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "disabled-team");
    expect(screen.queryByRole("button", { name: /be om tilgang/i })).toBeNull();
  });

  it("falls back to the non-sensitive denied/request-access state when the ambiguous absent-entry fallback is forbidden (non-admin, unrelated team)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [] });
    fetchTeamResultsMock.mockResolvedValue({ status: "forbidden" });

    render(<TeamDetail teamId="some-team" />);

    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "some-team");
    expect(screen.queryByText(/\d+ svar/)).toBeNull();
    expect(screen.queryByText(/trend/i)).toBeNull();
  });

  it("renders the identical non-sensitive denied state for a genuinely nonexistent team as for a disabled/unrelated one", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [] });
    fetchTeamResultsMock.mockResolvedValue({ status: "forbidden" });

    render(<TeamDetail teamId="nonexistent-team" />);

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

    render(<TeamDetail teamId="team-1" />);

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

    render(<TeamDetail teamId="team-1" />);

    await screen.findByRole("button", { name: /be om tilgang/i });
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("falls back to an access-required state if the results endpoint denies a caller the overview showed as a member (race)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue({ status: "forbidden" });

    render(<TeamDetail teamId="team-1" />);

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

    render(<TeamDetail teamId="team-1" />);

    await screen.findByRole("link", { name: /logg inn/i });
  });

  it("shows a Norwegian results-unavailable error, distinct from the page-level error, on a results read failure", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });

    render(<TeamDetail teamId="team-1" />);

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

    render(<TeamDetail teamId="team-1" />);

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

    render(<TeamDetail teamId="team-1" />);

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

    const { container } = render(<TeamDetail teamId="team-1" />);
    await screen.findByText("Platform");

    expect(container.textContent).not.toMatch(/@|uid|invited|ciphertext|\biv\b|\btag\b/i);
  });

  it("unsubscribes from id token updates on unmount", () => {
    const unsubscribe = vi.fn();
    observeIdTokenMock.mockImplementation(() => unsubscribe);

    const { unmount } = render(<TeamDetail teamId="team-1" />);
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("contains no leftover English copy", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });

    render(<TeamDetail teamId="team-1" />);
    await screen.findByRole("button", { name: /be om tilgang/i });

    expect(screen.queryByText(/^sign in$/i)).toBeNull();
    expect(screen.queryByText(/^request access$/i)).toBeNull();
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

    render(<TeamDetail teamId="team-1" />);
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

    render(<TeamDetail teamId="team-1" />);
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

    render(<TeamDetail teamId="team-1" />);
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

    render(<TeamDetail teamId="team-1" />);
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

    const { unmount } = render(<TeamDetail teamId="team-1" />);
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

    const { rerender } = render(<TeamDetail teamId="team-a" />);
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    rerender(<TeamDetail teamId="team-b" />);
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

    const { rerender } = render(<TeamDetail teamId="team-a" />);
    await waitFor(() => expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "team-a"));

    rerender(<TeamDetail teamId="team-b" />);
    await screen.findByRole("heading", { level: 1 });

    // Team A's fallback results request resolves late as fully authorized —
    // it must never be allowed to render on team B's now-current page.
    resolveTeamAResults(PUBLISHED_RESULTS);
    await flushMicrotasks();

    expect(screen.queryByText("7 svar")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team");
  });

  it("ignores a post-request-access refresh result if the account switches before it resolves", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    const calls = queuedCalls(fetchTeamsOverviewMock);
    requestTeamAccessMock.mockResolvedValue({ ok: true, outcome: "created" });

    render(<TeamDetail teamId="team-1" />);
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

// data is kept so the boundary also covers the TrendTable row keys.
describe("TeamDetail header (visual-redesign TASK-008)", () => {
  beforeEach(() => {
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
    fetchSkillNeedsMock.mockReturnValue(new Promise(() => {}));
    fetchSkillNeedsMock.mockReturnValue(new Promise(() => {}));
    fetchSkillContributionMock.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    fetchTeamResultsMock.mockReset();
  });

  it("shows the team name once, as the only level-1 heading of the authorized overview", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Demo Team", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    render(<TeamDetail teamId="team-1" />);
    await screen.findByRole("heading", { level: 1 });

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("Demo Team");
    expect(screen.getAllByText("Demo Team")).toHaveLength(1);
  });
});

describe("TeamDetail tabs and insufficient data (visual-redesign TASK-008)", () => {
  beforeEach(() => {
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
    fetchSkillNeedsMock.mockReturnValue(new Promise(() => {}));
    fetchSkillNeedsMock.mockReturnValue(new Promise(() => {}));
    fetchSkillContributionMock.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    fetchTeamResultsMock.mockReset();
  });

  it("offers only the approved team routes as tabs (Oversikt, Roadmap, Kompetanseplan, Teamkompetanse, Systemoversikt)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Demo Team", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    render(<TeamDetail teamId="team-1" />);
    await screen.findByRole("heading", { level: 1 });

    const nav = screen.getByRole("navigation", { name: teamsCopy.nav.label });
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/teams/team-1",
      "/teams/team-1/roadmap",
      "/teams/team-1/competence-plan",
      "/teams/team-1/competence",
      "/teams/team-1/systems",
    ]);
  });

});

describe("team overview heading structure (visual-redesign TASK-019)", () => {
  it("has one level-1 team heading and a valid hierarchy for the authorized overview", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Demo Team", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
    fetchSkillNeedsMock.mockReturnValue(new Promise(() => {}));
    fetchSkillNeedsMock.mockReturnValue(new Promise(() => {}));
    fetchSkillContributionMock.mockReturnValue(new Promise(() => {}));

    render(<TeamDetail teamId="team-1" />);
    await screen.findByRole("heading", { level: 1, name: "Demo Team" });
    expectHeadingStructure(document.body, { ownsPageTitle: true });
    expectNamedControls(document.body);
  });
});

describe("TeamDetail Oversikt after the results move (team-experience-redesign BR-5)", () => {
  beforeEach(() => {
    fetchCurrentTeamSurveyMock.mockResolvedValue(NO_CURRENT_SURVEY);
    fetchTeamChallengesMock.mockResolvedValue(NO_CHALLENGES);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
    fetchSkillNeedsMock.mockReturnValue(new Promise(() => {}));
    fetchSkillNeedsMock.mockReturnValue(new Promise(() => {}));
    fetchSkillContributionMock.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    cleanup();
  });

  it("links to the results route and renders no survey history, trend table or chart on Oversikt", async () => {
    cleanup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    render(<TeamDetail teamId="team-1" />);
    await screen.findByRole("heading", { level: 1 });

    const link = screen.getByRole("link", { name: teamsCopy.results.openLink });
    expect(link.getAttribute("href")).toBe("/teams/team-1/results");
    expect(screen.queryByText("7 svar")).toBeNull();
    expect(screen.queryByText(/minst 5 personer har svart/i)).toBeNull();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
    expect(fetchCurrentTeamSurveyMock).not.toHaveBeenCalled();
  });
});

describe("TeamDetail overview composition (team overview redesign, reference 18)", () => {
  beforeEach(() => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);
    fetchTeamChallengesMock.mockResolvedValue({
      status: "ok",
      challenges: [
        { challengeId: "c1", text: "Deploy owner unclear", status: "open", submittedAt: "2026-01-10" },
        { challengeId: "c2", text: "Old resolved item", status: "resolved", submittedAt: "2025-12-01" },
      ],
      canSubmit: true,
    });
    fetchTeamSkillsMock.mockResolvedValue(NO_SKILLS);
    fetchTeamThreadsMock.mockResolvedValue(NO_THREADS);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the header actions and the compact open-challenges card, without detailed workflows", async () => {
    render(<TeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: teamsCopy.detail.editTeam }).getAttribute("href")).toBe("/teams/team-1/settings");
    expect(screen.getByRole("link", { name: teamsCopy.results.openLink }).getAttribute("href")).toBe("/teams/team-1/results");

    const challengesCard = document.getElementById("team-oversikt-challenges")?.closest("section");
    expect(challengesCard?.textContent).toMatch(/Deploy owner unclear/);
    expect(challengesCard?.textContent).not.toMatch(/Old resolved item/);
    expect(screen.queryByRole("button", { name: /lagre|send|opprett/i })).toBeNull();
  });

  it("does not embed the challenge form, forum, skill tracking, needs, roster or visibility controls", async () => {
    render(<TeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("heading", { name: "Forum" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Kompetanseområder" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Kompetansebehov og dekning" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Teamaktivitet" })).toBeNull();
    expect(screen.queryByRole("button", { name: /inviter/i })).toBeNull();
    expect(fetchTeamRosterMock).not.toHaveBeenCalled();
    expect(fetchSkillNeedsMock).not.toHaveBeenCalled();
    expect(fetchTeamThreadsMock).not.toHaveBeenCalled();
  });

  it("offers Meld inn utfordring on the open-challenges card when the server says the caller can submit", async () => {
    render(<TeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { level: 1 });
    const challengesCard = document.getElementById("team-oversikt-challenges")?.closest("section");
    expect(challengesCard?.querySelector("button")?.textContent).toBe("Meld inn utfordring");
  });

  it("hides the submission action when the server says the caller cannot submit", async () => {
    fetchTeamChallengesMock.mockResolvedValue({
      status: "ok",
      challenges: [{ challengeId: "c1", text: "Deploy owner unclear", status: "open", submittedAt: "2026-01-10" }],
      canSubmit: false,
    });
    render(<TeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Meld inn utfordring" })).toBeNull();
  });

  it("after a successful submission re-reads only the challenges and updates the list and open count", async () => {
    const user = userEvent.setup();
    submitChallengeMock.mockResolvedValue({ status: "ok" });
    render(<TeamDetail teamId="team-1" />);

    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector('section[aria-label="Åpne utfordringer"] p.text-metric')?.textContent).toBe("1");

    const resultsCallsBefore = fetchTeamResultsMock.mock.calls.length;
    fetchTeamChallengesMock.mockResolvedValueOnce({
      status: "ok",
      challenges: [
        { challengeId: "c1", text: "Deploy owner unclear", status: "open", submittedAt: "2026-01-10" },
        { challengeId: "c3", text: "Fresh open item", status: "open", submittedAt: "2026-02-01" },
      ],
      canSubmit: true,
    });

    await user.click(screen.getByRole("button", { name: "Meld inn utfordring" }));
    await user.type(screen.getByLabelText("Utfordring"), "Fresh open item");
    await user.click(screen.getByRole("button", { name: "Send inn" }));

    await screen.findByRole("button", { name: "Lukk" });
    await waitFor(() => {
      const count = document.querySelector('section[aria-label="Åpne utfordringer"] p.text-metric');
      expect(count?.textContent).toBe("2");
    });
    const challengesCard = document.getElementById("team-oversikt-challenges")?.closest("section");
    expect(challengesCard?.textContent).toMatch(/Fresh open item/);
    expect(fetchTeamResultsMock.mock.calls.length).toBe(resultsCallsBefore);
  });
});

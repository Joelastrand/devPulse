// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
const fetchTeamsOverviewMock = vi.fn();
const requestTeamAccessMock = vi.fn();
const fetchTeamResultsMock = vi.fn();

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

const { TeamDetail } = await import("./TeamDetail");

const PUBLISHED_RESULTS = {
  status: "ok",
  teamId: "team-1",
  current: {
    period: "2026-W35",
    status: "published",
    mean: { flow: 3.2, stress: 2.8, fun: 4.1 },
    count: 7,
  },
  trend: [
    { period: "2026-W34", status: "insufficient" },
    {
      period: "2026-W35",
      status: "published",
      mean: { flow: 3.2, stress: 2.8, fun: 4.1 },
      count: 7,
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

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TeamDetail", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
    fetchTeamResultsMock.mockReset();
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

    expect(await screen.findByText("7 svar")).toBeTruthy();
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

  it("fetches and renders results for a member", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue(PUBLISHED_RESULTS);

    render(<TeamDetail teamId="team-1" />);

    await screen.findByText("Platform");
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "team-1");
    expect(screen.getByText("7 svar")).toBeTruthy();
    // Matches TrendTable's own heading specifically — TrendChart (TASK-010)
    // also renders a heading containing "trend", so a bare /trend/i match
    // would now be ambiguous between the two.
    expect(screen.getByText(/trend \(/i)).toBeTruthy();
    // The trend chart (TASK-010) renders alongside — not instead of — the
    // table above, sourced from the exact same already-fetched `trend`
    // data: no second `fetchTeamResults` call.
    expect(screen.getByRole("heading", { name: /trendvisualisering/i })).toBeTruthy();
    expect(fetchTeamResultsMock).toHaveBeenCalledTimes(1);
  });

  it("fetches and renders results for an app admin", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "admin" }],
    });
    fetchTeamResultsMock.mockResolvedValue({
      status: "ok",
      teamId: "team-1",
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
    });

    render(<TeamDetail teamId="team-1" />);

    await screen.findByText("Platform");
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "team-1");
    await screen.findByText(/ikke nok svar ennå for denne perioden/i);
  });

  it("never renders a response count for an insufficient-data period", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    fetchTeamResultsMock.mockResolvedValue({
      status: "ok",
      teamId: "team-1",
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
    });

    const { container } = render(<TeamDetail teamId="team-1" />);

    await screen.findByText(/ikke nok svar ennå for denne perioden/i);
    expect(container.textContent).not.toMatch(/\d+ svar/);
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
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
    fetchTeamResultsMock.mockReset();
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
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
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
        current: { period: "2026-W35", status: "insufficient" },
        trend: [{ period: "2026-W35", status: "insufficient" }],
      });

    const { rerender } = render(<TeamDetail teamId="team-a" />);
    await waitFor(() => expect(fetchTeamResultsMock).toHaveBeenCalledWith("a-token", "team-a"));

    rerender(<TeamDetail teamId="team-b" />);
    await screen.findByText(/ikke nok svar ennå for denne perioden/i);

    // Team A's fallback results request resolves late as fully authorized —
    // it must never be allowed to render on team B's now-current page.
    resolveTeamAResults(PUBLISHED_RESULTS);
    await flushMicrotasks();

    expect(screen.queryByText("7 svar")).toBeNull();
    expect(screen.getByText(/ikke nok svar ennå for denne perioden/i)).toBeTruthy();
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

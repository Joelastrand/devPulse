// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
const fetchTeamsOverviewMock = vi.fn();
const requestTeamAccessMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/teams-overview-gateway", () => ({
  fetchTeamsOverview: fetchTeamsOverviewMock,
  requestTeamAccess: requestTeamAccessMock,
}));

const { TeamsOverview } = await import("./TeamsOverview");

/** Simulates the auth subscription immediately emitting one token value. */
function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

/**
 * Captures the `observeIdToken` callback so a test can fire multiple auth
 * events (sign-out, account switch, token refresh) at will, rather than
 * only the single immediate emission `subscribingWith` provides.
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

/**
 * Queues one manually-resolvable promise per `fetchTeamsOverview` call, in
 * call order, so a test can control exactly which call resolves first —
 * independent of which auth event started it.
 */
function queuedOverviewCalls() {
  const resolvers: Array<(value: unknown) => void> = [];
  fetchTeamsOverviewMock.mockImplementation(
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

describe("TeamsOverview", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
  });

  it("prompts sign-in when the visitor is signed out, and never fetches", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<TeamsOverview />);

    await screen.findByRole("link", { name: /logg inn/i });
    expect(fetchTeamsOverviewMock).not.toHaveBeenCalled();
  });

  it("prompts sign-in when the server reports 'unauthenticated'", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "unauthenticated" });

    render(<TeamsOverview />);

    await screen.findByRole("link", { name: /logg inn/i });
  });

  it("shows a Norwegian generic error state on a read failure, never a fabricated list", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "read_failed" });

    render(<TeamsOverview />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
  });

  it("shows a Norwegian no-teams state when the caller has no teams to see", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [] });

    render(<TeamsOverview />);

    const status = await screen.findByText(/ingen team/i);
    expect(status.getAttribute("role")).toBe("status");
  });

  it("shows each team's name and Norwegian relationship label for a verified user with multiple teams", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-1", name: "Platform", relationship: "member" },
        { teamId: "team-2", name: "Mobile", relationship: "admin" },
        { teamId: "team-3", name: "Data", relationship: "none" },
      ],
    });

    render(<TeamsOverview />);

    await screen.findByText("Platform");
    expect(screen.getByText("Mobile")).toBeTruthy();
    expect(screen.getByText("Data")).toBeTruthy();
    expect(screen.getByText("Medlem")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByText("Ikke medlem")).toBeTruthy();
  });

  it("renders each team's relationship label via the shared Badge primitive, not a bare paragraph (BR-10)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });

    render(<TeamsOverview />);

    const label = await screen.findByText("Medlem");
    expect(label.tagName).toBe("SPAN");
  });

  it("links a member's or admin's team name to its detail page, but not a non-member's", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-1", name: "Platform", relationship: "member" },
        { teamId: "team-2", name: "Mobile", relationship: "admin" },
        { teamId: "team-3", name: "Data", relationship: "none" },
      ],
    });

    render(<TeamsOverview />);

    const platformLink = await screen.findByRole("link", { name: "Platform" });
    expect(platformLink.getAttribute("href")).toBe("/teams/team-1");
    const mobileLink = screen.getByRole("link", { name: "Mobile" });
    expect(mobileLink.getAttribute("href")).toBe("/teams/team-2");
    expect(screen.queryByRole("link", { name: "Data" })).toBeNull();
  });

  it("shows a Norwegian 'request pending' state without a request-access action", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_pending" }],
    });

    render(<TeamsOverview />);

    await screen.findByText(/forespørsel venter/i);
    expect(screen.queryByRole("button", { name: /be om tilgang/i })).toBeNull();
  });

  it("offers a Norwegian request-access action for a 'none' relationship", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });

    render(<TeamsOverview />);

    await screen.findByRole("button", { name: /be om tilgang/i });
  });

  it("offers a request-access action for a rejected request", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_rejected" }],
    });

    render(<TeamsOverview />);

    await screen.findByRole("button", { name: /be om tilgang/i });
  });

  it("submits a request-access action via the TASK-005 gateway and refreshes to the resulting state", async () => {
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

    render(<TeamsOverview />);

    const button = await screen.findByRole("button", { name: /be om tilgang/i });
    await user.click(button);

    expect(requestTeamAccessMock).toHaveBeenCalledWith("a-token", "team-1");
    await screen.findByText(/forespørsel venter/i);
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2);
  });

  it("marks the request-access button pending and aria-busy while the action is in flight", async () => {
    let resolveRequest: (value: { ok: true; outcome: "created" }) => void = () => {};
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });
    requestTeamAccessMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    render(<TeamsOverview />);

    const button = await screen.findByRole("button", { name: /be om tilgang/i });
    await user.click(button);

    const pendingButton = screen.getByRole("button", { name: /sender forespørsel/i });
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");

    resolveRequest({ ok: true, outcome: "created" });
    await screen.findByRole("button", { name: /be om tilgang/i });
  });

  it("shows a Norwegian inline error and leaves the row actionable when the request-access action fails", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });
    requestTeamAccessMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    render(<TeamsOverview />);

    const button = await screen.findByRole("button", { name: /be om tilgang/i });
    await user.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/deaktivert/i);
  });

  it("never renders member/invitation/access-request identity data", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });

    const { container } = render(<TeamsOverview />);
    await screen.findByText("Platform");

    expect(container.textContent).not.toMatch(/@|uid|admin@|invited/i);
  });

  it("unsubscribes from id token updates on unmount", () => {
    const unsubscribe = vi.fn();
    observeIdTokenMock.mockImplementation(() => unsubscribe);

    const { unmount } = render(<TeamsOverview />);
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("shows a Norwegian loading state before auth resolves", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<TeamsOverview />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("waits for the auth callback before rendering a final state", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [] });

    render(<TeamsOverview />);

    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledWith("a-token"));
  });

  it("contains no leftover English copy", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });

    render(<TeamsOverview />);
    await screen.findByRole("button", { name: /be om tilgang/i });

    expect(screen.queryByText(/^sign in$/i)).toBeNull();
    expect(screen.queryByText(/^request access$/i)).toBeNull();
    expect(screen.queryByText(/not a member/i)).toBeNull();
  });
});

describe("TeamsOverview auth-state races", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    requestTeamAccessMock.mockReset();
  });

  it("ignores a stale overview result that resolves after the user has signed out", async () => {
    const observer = capturingObserver();
    const calls = queuedOverviewCalls();

    render(<TeamsOverview />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    calls.resolve(0, {
      status: "ok",
      teams: [{ teamId: "team-a", name: "Team A", relationship: "member" }],
    });
    await flushMicrotasks();

    expect(screen.queryByText("Team A")).toBeNull();
    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
  });

  it("shows only account B's teams when B's request resolves after A's request started (account switch)", async () => {
    const observer = capturingObserver();
    const calls = queuedOverviewCalls();

    render(<TeamsOverview />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    observer.emit("token-b");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2));

    calls.resolve(1, {
      status: "ok",
      teams: [{ teamId: "team-b", name: "Team B", relationship: "member" }],
    });
    await screen.findByText("Team B");

    calls.resolve(0, {
      status: "ok",
      teams: [{ teamId: "team-a", name: "Team A", relationship: "member" }],
    });
    await flushMicrotasks();

    expect(screen.queryByText("Team A")).toBeNull();
    expect(screen.getByText("Team B")).toBeTruthy();
  });

  it("ignores A's result even though it resolves before B's, and shows B's once it arrives (reverse completion)", async () => {
    const observer = capturingObserver();
    const calls = queuedOverviewCalls();

    render(<TeamsOverview />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    observer.emit("token-b");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2));

    calls.resolve(0, {
      status: "ok",
      teams: [{ teamId: "team-a", name: "Team A", relationship: "member" }],
    });
    await flushMicrotasks();

    expect(screen.queryByText("Team A")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/laster/i);

    calls.resolve(1, {
      status: "ok",
      teams: [{ teamId: "team-b", name: "Team B", relationship: "member" }],
    });
    await screen.findByText("Team B");
  });

  it("ignores an older token-refresh result once a newer refresh has already started", async () => {
    const observer = capturingObserver();
    const calls = queuedOverviewCalls();

    render(<TeamsOverview />);
    observer.emit("token-a1");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    observer.emit("token-a2");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2));

    calls.resolve(1, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
    });
    await screen.findByText("Medlem");

    calls.resolve(0, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform (stale)", relationship: "none" }],
    });
    await flushMicrotasks();

    expect(screen.queryByText("Platform (stale)")).toBeNull();
    expect(screen.getByText("Medlem")).toBeTruthy();
  });

  it("ignores a post-request-access refresh result if the user signs out before it resolves", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    const calls = queuedOverviewCalls();
    requestTeamAccessMock.mockResolvedValue({ ok: true, outcome: "created" });

    render(<TeamsOverview />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    calls.resolve(0, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });
    const button = await screen.findByRole("button", { name: /be om tilgang/i });
    await user.click(button);

    // requestTeamAccess resolved; the post-action refresh (second
    // fetchTeamsOverview call) is now in flight.
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2));

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    calls.resolve(1, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_pending" }],
    });
    await flushMicrotasks();

    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
    expect(screen.queryByText(/forespørsel venter/i)).toBeNull();
  });

  it("ignores a post-request-access refresh result if the account switches before it resolves", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    const calls = queuedOverviewCalls();
    requestTeamAccessMock.mockResolvedValue({ ok: true, outcome: "created" });

    render(<TeamsOverview />);
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
      teams: [{ teamId: "team-2", name: "Mobile", relationship: "member" }],
    });
    await screen.findByText("Mobile");

    calls.resolve(1, {
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "request_pending" }],
    });
    await flushMicrotasks();

    expect(screen.queryByText("Platform")).toBeNull();
    expect(screen.getByText("Mobile")).toBeTruthy();
  });

  it("does not update state after unmount even if a pending overview fetch resolves later", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const observer = capturingObserver();
    const calls = queuedOverviewCalls();

    const { unmount } = render(<TeamsOverview />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    unmount();

    expect(() =>
      calls.resolve(0, {
        status: "ok",
        teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
      }),
    ).not.toThrow();
    await flushMicrotasks();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

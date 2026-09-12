// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const observeIdTokenMock = vi.fn();
const fetchTeamsOverviewMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../../teams/client/teams-overview-gateway", () => ({
  fetchTeamsOverview: fetchTeamsOverviewMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

const { ResultsRedirect } = await import("./ResultsRedirect");

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

/** Captures the `observeIdToken` callback so a test can fire a later auth event (account switch). */
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

describe("ResultsRedirect", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchTeamsOverviewMock.mockReset();
    replaceMock.mockReset();
  });

  it("redirects a signed-out visitor to /teams without fetching the overview", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<ResultsRedirect />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/teams"));
    expect(fetchTeamsOverviewMock).not.toHaveBeenCalled();
  });

  it("redirects a user with exactly one membership to that team's /teams/[teamId]", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-1", name: "Platform", relationship: "member" },
        { teamId: "team-2", name: "Mobile", relationship: "none" },
      ],
    });

    render(<ResultsRedirect />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/teams/team-1"));
  });

  it("redirects a user with zero memberships to /teams", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "none" }],
    });

    render(<ResultsRedirect />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/teams"));
  });

  it("redirects a user with more than one membership to /teams", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-1", name: "Platform", relationship: "member" },
        { teamId: "team-2", name: "Mobile", relationship: "member" },
      ],
    });

    render(<ResultsRedirect />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/teams"));
  });

  it("treats an app admin (relationship 'admin', not 'member') as not having a single membership, redirecting to /teams", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", relationship: "admin" }],
    });

    render(<ResultsRedirect />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/teams"));
  });

  it("redirects to /teams on a read failure rather than leaving the user stuck", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "read_failed" });

    render(<ResultsRedirect />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/teams"));
  });

  it("redirects to /teams when the overview reports unauthenticated despite a token", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "unauthenticated" });

    render(<ResultsRedirect />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/teams"));
  });

  it("ignores a stale overview result if the account switches before it resolves", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const observer = capturingObserver();
    fetchTeamsOverviewMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "team-b", name: "Mobile", relationship: "member" }],
      });

    render(<ResultsRedirect />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1));

    observer.emit("token-b");
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/teams/team-b"));

    resolveFirst({
      status: "ok",
      teams: [{ teamId: "team-a", name: "Platform", relationship: "member" }],
    });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));

    expect(replaceMock).not.toHaveBeenCalledWith("/teams/team-a");
  });

  it("renders a non-sensitive Norwegian status message while redirecting", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<ResultsRedirect />);

    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/omdirigerer/i);
  });
});

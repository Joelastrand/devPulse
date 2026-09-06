// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const observeIdTokenMock = vi.fn();
const fetchDashboardMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/dashboard-gateway", () => ({
  fetchDashboard: fetchDashboardMock,
}));

const { Dashboard, renderDashboardResult } = await import("./Dashboard");

/** Simulates the auth subscription immediately emitting one token value. */
function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

describe("Dashboard", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchDashboardMock.mockReset();
  });

  it("prompts sign-in when the visitor is signed out", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<Dashboard />);

    await screen.findByRole("link", { name: /sign in/i });
    expect(fetchDashboardMock).not.toHaveBeenCalled();
  });

  it("shows a no-team state and no aggregate data when the caller has no resolved team", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchDashboardMock.mockResolvedValue({ status: "no_team" });

    render(<Dashboard />);

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/no team/i);
    expect(screen.queryByText(/responses/i)).toBeNull();
  });

  it("does not reveal team names, allowed emails, or authorization internals in the no-team state", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchDashboardMock.mockResolvedValue({ status: "no_team" });

    render(<Dashboard />);

    const status = await screen.findByRole("status");
    expect(status.textContent).not.toMatch(
      /platform|@|allowed|assignment|admin/i,
    );
  });

  it("shows an insufficient-responses state without revealing a count", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchDashboardMock.mockResolvedValue({
      status: "ok",
      teamId: "platform",
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
    });

    render(<Dashboard />);

    expect(
      await screen.findAllByText(/not enough responses/i),
    ).not.toHaveLength(0);
  });

  it("shows the published aggregate for the current period and trend", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchDashboardMock.mockResolvedValue({
      status: "ok",
      teamId: "platform",
      current: {
        period: "2026-W35",
        status: "published",
        mean: { flow: 3, stress: 2, fun: 4 },
        count: 5,
      },
      trend: [
        {
          period: "2026-W35",
          status: "published",
          mean: { flow: 3, stress: 2, fun: 4 },
          count: 5,
        },
        { period: "2026-W34", status: "insufficient" },
      ],
    });

    render(<Dashboard />);

    await screen.findByText("5 responses");
    expect(screen.getAllByText("2026-W35").length).toBeGreaterThan(0);
    expect(screen.getByText(/not enough responses/i)).toBeTruthy();
  });

  it("shows a generic error state on a read failure, never a fabricated result", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchDashboardMock.mockResolvedValue({ status: "read_failed" });

    render(<Dashboard />);

    await screen.findByRole("alert");
  });

  it("never renders any copy implying the open/current period has data", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchDashboardMock.mockResolvedValue({
      status: "ok",
      teamId: "platform",
      current: { period: "2026-W35", status: "insufficient" },
      trend: [{ period: "2026-W35", status: "insufficient" }],
    });

    const { container } = render(<Dashboard />);
    await screen.findByRole("status");

    expect(container.textContent).not.toMatch(/open period|current period is/i);
  });

  it("unsubscribes from id token updates on unmount", () => {
    const unsubscribe = vi.fn();
    observeIdTokenMock.mockImplementation(() => unsubscribe);

    const { unmount } = render(<Dashboard />);
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe("renderDashboardResult", () => {
  it("throws rather than silently rendering nothing for an unrecognized status", () => {
    // `DashboardFetchResult` only has 4 known statuses; this simulates a
    // future/unvalidated variant reaching the switch to prove the
    // exhaustiveness guard fails loudly instead of returning `undefined`.
    const unrecognized = { status: "some_future_status" } as unknown as Parameters<
      typeof renderDashboardResult
    >[0];

    expect(() => renderDashboardResult(unrecognized)).toThrow(
      /unhandled dashboard result/i,
    );
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const observeIdTokenMock = vi.fn();
const fetchTeamsOverviewMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../../teams/client/teams-overview-gateway", () => ({
  fetchTeamsOverview: fetchTeamsOverviewMock,
}));

const { ProfileHeaderTeams } = await import("./ProfileHeaderTeams");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function signedInWith(token: string | null) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  });
}

describe("ProfileHeaderTeams", () => {
  it("shows only genuine memberships: an admin-only team and pending requests are not shown", async () => {
    signedInWith("token");
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "t1", name: "Plattform", relationship: "member", isMember: true },
        { teamId: "t2", name: "Design", relationship: "admin", isMember: false },
        { teamId: "t3", name: "Data", relationship: "request_pending" },
      ],
    });

    render(<ProfileHeaderTeams />);

    expect(await screen.findByText("Plattform")).toBeTruthy();
    expect(screen.queryByText(/Design/)).toBeNull();
    expect(screen.queryByText(/Data/)).toBeNull();
  });

  it("shows a superadmin only the teams where they hold a real membership", async () => {
    signedInWith("token");
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "t1", name: "Plattform", relationship: "admin", isMember: true },
        { teamId: "t2", name: "Design", relationship: "admin", isMember: false },
      ],
    });

    render(<ProfileHeaderTeams />);

    expect(await screen.findByText("Plattform")).toBeTruthy();
    expect(screen.queryByText(/Design/)).toBeNull();
  });

  it("renders nothing when the viewer has no team membership", async () => {
    signedInWith("token");
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "t3", name: "Data", relationship: "request_pending" }],
    });

    const { container } = render(<ProfileHeaderTeams />);

    await act(async () => {});
    await act(async () => {});
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the overview cannot be read, with no error copy", async () => {
    signedInWith("token");
    fetchTeamsOverviewMock.mockResolvedValue({ status: "read_failed" });

    const { container } = render(<ProfileHeaderTeams />);

    await act(async () => {});
    expect(container.textContent).toBe("");
  });
});

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
  it("shows only teams the viewer is a member or admin of, not pending requests", async () => {
    signedInWith("token");
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "t1", name: "Plattform", relationship: "member" },
        { teamId: "t2", name: "Design", relationship: "admin" },
        { teamId: "t3", name: "Data", relationship: "request_pending" },
      ],
    });

    render(<ProfileHeaderTeams />);

    expect(await screen.findByText("Plattform, Design")).toBeTruthy();
    expect(screen.queryByText(/Data/)).toBeNull();
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

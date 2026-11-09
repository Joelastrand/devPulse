// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

const fetchLevelsMock = vi.fn();

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const { useEffect } = await import("react");
  return {
    useAuthGatedResource: (onAuthChange: (token: string | null) => void) => {
      useEffect(() => onAuthChange("token-for-test"), []);
      return { isCurrentGeneration: () => true };
    },
  };
});

vi.mock("../../team-skills/client/team-skills-gateway", () => ({
  fetchTeamSkillLevels: fetchLevelsMock,
}));

// Recharts measures the DOM; the panel test checks the data it receives, as the radar tests do.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RadarChart: ({ data, children }: { data: unknown; children: ReactNode }) => (
    <div data-testid="radar-chart" data-points={JSON.stringify(data)}>
      {children}
    </div>
  ),
  PolarGrid: () => null,
  PolarAngleAxis: () => null,
  PolarRadiusAxis: () => null,
  Radar: () => null,
}));

const { TeamCompetenceProfile } = await import("./TeamCompetenceProfile");
const { TEAM_PROFILE_STATE_COPY } = await import("../copy");

afterEach(() => {
  cleanup();
  fetchLevelsMock.mockReset();
});

/** Synthetic fixtures only. */
const available = (rows: unknown[]) => ({ status: "ok", availability: "available", rows });

describe("TeamCompetenceProfile: states", () => {
  it("shows the server's team values as the radar, with a gap for an insufficient area and never a zero", async () => {
    fetchLevelsMock.mockResolvedValue(
      available([
        { treeId: "t1", areaName: "Område 1", targetLevel: 3, state: "value", level: 2 },
        { treeId: "t2", areaName: "Område 2", targetLevel: 3, state: "insufficient_data" },
        { treeId: "t3", areaName: "Område 3", targetLevel: 4, state: "value", level: 4 },
      ]),
    );
    const { container } = render(<TeamCompetenceProfile teamId="team-1" />);
    await waitFor(() => expect(within(container).getByTestId("radar-chart")).toBeTruthy());
    const points = JSON.parse(within(container).getByTestId("radar-chart").getAttribute("data-points") ?? "[]") as Array<{
      team: number | null;
    }>;
    expect(points.map((p) => p.team)).toEqual([2, null, 4]);
    expect(fetchLevelsMock).toHaveBeenCalledWith("token-for-test", "team-1");
  });

  it("shows the incomplete message and draws no chart", async () => {
    fetchLevelsMock.mockResolvedValue({ status: "ok", availability: "incomplete", rows: [] });
    const { container } = render(<TeamCompetenceProfile teamId="team-1" />);
    expect(await screen.findByText(TEAM_PROFILE_STATE_COPY.incomplete)).toBeTruthy();
    expect(within(container).queryByTestId("radar-chart")).toBeNull();
  });

  it.each([
    ["forbidden", TEAM_PROFILE_STATE_COPY.forbidden],
    ["team_disabled", TEAM_PROFILE_STATE_COPY.teamDisabled],
    ["read_failed", TEAM_PROFILE_STATE_COPY.readFailed],
  ])("shows the %s message and no chart", async (status, message) => {
    fetchLevelsMock.mockResolvedValue({ status });
    const { container } = render(<TeamCompetenceProfile teamId="team-1" />);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(within(container).queryByTestId("radar-chart")).toBeNull();
  });

  it("offers a retry after a read failure and fetches again when pressed", async () => {
    const userEventModule = await import("@testing-library/user-event");
    fetchLevelsMock.mockResolvedValueOnce({ status: "read_failed" }).mockResolvedValueOnce(available([]));
    render(<TeamCompetenceProfile teamId="team-1" />);
    const retry = await screen.findByRole("button", { name: TEAM_PROFILE_STATE_COPY.retry });
    await userEventModule.default.setup().click(retry);
    await waitFor(() => expect(fetchLevelsMock).toHaveBeenCalledTimes(2));
  });
});

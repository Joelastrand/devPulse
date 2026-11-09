// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamHeaderMetrics, TEAM_HEADER_METRIC_COPY } from "./TeamHeaderMetrics";

const fetchTeamSystems = vi.fn();

vi.mock("../../team-systems/client/team-systems-gateway", () => ({
  fetchTeamSystems: (...args: unknown[]) => fetchTeamSystems(...args),
}));

const system = { id: "s1" } as never;

describe("TeamHeaderMetrics", () => {
  beforeEach(() => {
    fetchTeamSystems.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a complete system count beside the competence-area count", async () => {
    fetchTeamSystems.mockResolvedValue({ status: "ok", systems: [system], canEdit: false, truncated: false });

    render(<TeamHeaderMetrics teamId="team-1" token="t" competenceAreas={6} />);

    expect(await screen.findByText("1 system")).not.toBeNull();
    expect(screen.getByText("6 kompetanseområder")).not.toBeNull();
  });

  it("omits the system count when the list is truncated instead of showing a partial total", async () => {
    fetchTeamSystems.mockResolvedValue({ status: "ok", systems: [system], canEdit: false, truncated: true });

    render(<TeamHeaderMetrics teamId="team-1" token="t" competenceAreas={null} />);

    await waitFor(() => expect(fetchTeamSystems).toHaveBeenCalledWith("t", "team-1"));
    expect(screen.queryByText(/system/)).toBeNull();
  });

  it("shows no count when the system read is forbidden and no area count exists, never a zero", async () => {
    fetchTeamSystems.mockResolvedValue({ status: "forbidden" });

    const { container } = render(<TeamHeaderMetrics teamId="team-1" token="t" competenceAreas={null} />);

    await waitFor(() => expect(fetchTeamSystems).toHaveBeenCalledWith("t", "team-1"));
    expect(container.textContent).toBe("");
    expect(screen.queryByLabelText(TEAM_HEADER_METRIC_COPY.label)).toBeNull();
  });
});

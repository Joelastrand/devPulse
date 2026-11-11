// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { teamsCopy } from "../copy";

const fetchTeamsOverviewMock = vi.fn();

vi.mock("../client/teams-overview-gateway", () => ({
  fetchTeamsOverview: (token: string) => fetchTeamsOverviewMock(token),
}));

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const { useEffect } = await import("react");
  return {
    useAuthGatedResource: (onAuthChange: (token: string | null, generation: number, isCurrent: () => boolean) => void) => {
      // The real hook runs its callback from an effect keyed on [teamId]; the test mock does the same once per mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => {
        onAuthChange(currentToken, 1, () => true);
      }, []);
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams/team-1/competence",
}));

let currentToken: string | null = "token-1";

const { TeamPageHeader } = await import("./TeamPageHeader");

describe("TeamPageHeader", () => {
  afterEach(() => {
    cleanup();
    fetchTeamsOverviewMock.mockReset();
    currentToken = "token-1";
  });

  it("shows the team name as the only h1 and the six tabs with the active tab marked", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Plattform", relationship: "member" }],
    });

    render(<TeamPageHeader teamId="team-1" />);

    expect(await screen.findByRole("heading", { level: 1, name: "Plattform" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: teamsCopy.nav.label });
    const links = within(nav).getAllByRole("link").map((link) => link.textContent);
    expect(links).toEqual(["Oversikt", "Roadmap", "Kompetanseplan", "Teamkompetanse", "Systemoversikt", "Kompetanser"]);
    expect(within(nav).getByRole("link", { name: "Teamkompetanse" }).getAttribute("aria-current")).toBe("page");
  });

  it("falls back to the generic team label when the overview read fails", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({ status: "read_failed" });

    render(<TeamPageHeader teamId="team-1" />);

    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalledWith("token-1"));
    expect(screen.getByRole("heading", { level: 1, name: teamsCopy.detail.fallbackName })).toBeTruthy();
  });

  it("does not fetch when signed out", async () => {
    currentToken = null;

    render(<TeamPageHeader teamId="team-1" />);

    expect(fetchTeamsOverviewMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: teamsCopy.detail.fallbackName })).toBeTruthy();
  });
});

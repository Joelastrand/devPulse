// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const fetchTeamsMock = vi.fn();
const fetchContributionMock = vi.fn();
const optInMock = vi.fn();
const withdrawMock = vi.fn();

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const { useEffect } = await import("react");
  return {
    useAuthGatedResource: (onAuthChange: (token: string | null) => void) => {
      useEffect(() => onAuthChange("token-for-test"), []);
      return { isCurrentGeneration: () => true };
    },
  };
});

vi.mock("../../teams/client/teams-overview-gateway", () => ({
  fetchTeamsOverview: fetchTeamsMock,
}));

vi.mock("../client/team-skills-gateway", () => ({
  fetchSkillContribution: fetchContributionMock,
  optInSkillContribution: optInMock,
  withdrawSkillContribution: withdrawMock,
}));

const { OwnCompetenceSharing } = await import("./OwnCompetenceSharing");

afterEach(() => {
  cleanup();
  fetchTeamsMock.mockReset();
  fetchContributionMock.mockReset();
  optInMock.mockReset();
  withdrawMock.mockReset();
});

const OPT_IN = "Del kompetanse med teamet";

describe("OwnCompetenceSharing on /me/skills (TASK-009, C2 participation composition)", () => {
  it("lists only the teams the caller is a member of, one independent control per team", async () => {
    fetchTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team Alfa", relationship: "member", isMember: true },
        { teamId: "team-b", name: "Team Beta", relationship: "lead", isMember: false },
        { teamId: "team-c", name: "Team Gamma", relationship: "none", isMember: false },
      ],
    });
    fetchContributionMock.mockImplementation(async (_token: string, teamId: string) => ({
      status: "ok",
      contributing: teamId === "team-a",
      canOptIn: true,
    }));

    render(<OwnCompetenceSharing />);

    expect(await screen.findByRole("heading", { name: "Deling med team" })).toBeTruthy();
    const alfa = await screen.findByRole("region", { name: /Team Alfa/ });
    expect(await within(alfa).findByText("Du deler kompetanse med teamet")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Team Beta/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /Team Gamma/ })).toBeNull();
    expect(fetchContributionMock).toHaveBeenCalledTimes(1);
    expect(fetchContributionMock).toHaveBeenCalledWith("token-for-test", "team-a");
  });

  it("gives each team's control its own heading id, so two panels on one page never share an id", async () => {
    fetchTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team Alfa", relationship: "member", isMember: true },
        { teamId: "team-b", name: "Team Beta", relationship: "member", isMember: true },
      ],
    });
    fetchContributionMock.mockResolvedValue({ status: "ok", contributing: false, canOptIn: true });

    const { container } = render(<OwnCompetenceSharing />);
    await screen.findByRole("region", { name: /Team Beta/ });

    const ids = Array.from(container.querySelectorAll("h4[id]")).map((heading) => heading.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("is OFF by default: a member team with no contribution shows the opt-in control and no withdraw control", async () => {
    fetchTeamsMock.mockResolvedValue({ status: "ok", teams: [{ teamId: "team-a", name: "Team Alfa", relationship: "member", isMember: true }] });
    fetchContributionMock.mockResolvedValue({ status: "ok", contributing: false, canOptIn: true });

    render(<OwnCompetenceSharing />);

    expect(await screen.findByRole("button", { name: OPT_IN })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Slutt å bidra" })).toBeNull();
    expect(optInMock).not.toHaveBeenCalled();
  });

  it("explains that nothing is shared when the caller belongs to no team, and calls no participation endpoint", async () => {
    fetchTeamsMock.mockResolvedValue({ status: "ok", teams: [{ teamId: "team-b", name: "Team Beta", relationship: "lead", isMember: false }] });

    render(<OwnCompetenceSharing />);

    expect(await screen.findByText("Du er ikke medlem av et team, så det finnes ingen deling å styre.")).toBeTruthy();
    expect(fetchContributionMock).not.toHaveBeenCalled();
  });

  it("fails closed with an alert and no control when the team list cannot be read", async () => {
    fetchTeamsMock.mockResolvedValue({ status: "error" });

    render(<OwnCompetenceSharing />);

    expect(await screen.findByText("Delingsvalgene dine kunne ikke lastes akkurat nå.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: OPT_IN })).toBeNull();
    expect(fetchContributionMock).not.toHaveBeenCalled();
  });
});

describe("OwnCompetenceSharing role distinctions (superadmin is not implicitly a member)", () => {
  it("shows the admin empty state with a team-admin link, and no sharing control, for a superadmin without membership", async () => {
    fetchTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team Alfa", relationship: "admin", isMember: false },
        { teamId: "team-b", name: "Team Beta", relationship: "admin", isMember: false },
      ],
    });

    render(<OwnCompetenceSharing />);

    expect(await screen.findByText(/Du er administrator, men ikke medlem av et team/)).toBeTruthy();
    expect(screen.queryByText("Du er ikke medlem av et team, så det finnes ingen deling å styre.")).toBeNull();
    expect(screen.getByRole("link", { name: "Gå til teamadministrasjon" }).getAttribute("href")).toBe("/admin/teams");
    expect(screen.queryByRole("region", { name: /Team Alfa/ })).toBeNull();
    expect(fetchContributionMock).not.toHaveBeenCalled();
  });

  it("offers the sharing control for a superadmin who is a genuine member of one team only", async () => {
    fetchTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-a", name: "Team Alfa", relationship: "admin", isMember: true },
        { teamId: "team-b", name: "Team Beta", relationship: "admin", isMember: false },
      ],
    });
    fetchContributionMock.mockResolvedValue({ status: "ok", contributing: false, canOptIn: true });

    render(<OwnCompetenceSharing />);

    const alfa = await screen.findByRole("region", { name: /Team Alfa/ });
    expect(await within(alfa).findByText("Du deler ikke kompetanse med teamet")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Team Beta/ })).toBeNull();
    expect(screen.queryByText(/Du er administrator, men ikke medlem/)).toBeNull();
    expect(fetchContributionMock).toHaveBeenCalledTimes(1);
  });

  it("shows the plain no-team message for an ordinary user with no relationships", async () => {
    fetchTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-a", name: "Team Alfa", relationship: "none", isMember: false }],
    });

    render(<OwnCompetenceSharing />);

    expect(await screen.findByText("Du er ikke medlem av et team, så det finnes ingen deling å styre.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Gå til teamadministrasjon" })).toBeNull();
  });
});

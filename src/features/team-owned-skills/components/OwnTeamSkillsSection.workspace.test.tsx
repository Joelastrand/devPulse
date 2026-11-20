// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Identity = string | null;
vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: (callback: (token: Identity) => void) => {
    callback("token-a");
    return () => {};
  },
}));

const fetchTeamsOverviewMock = vi.fn();
vi.mock("../../teams/client/teams-overview-gateway", () => ({ fetchTeamsOverview: fetchTeamsOverviewMock }));
const fetchTeamSkillsMock = vi.fn();
const setOwnTeamSkillRatingMock = vi.fn();
vi.mock("../client/team-skills-gateway", () => ({
  fetchTeamSkills: fetchTeamSkillsMock,
  setOwnTeamSkillRating: setOwnTeamSkillRatingMock,
  clearOwnTeamSkillRating: vi.fn(),
}));

const { OwnTeamSkillsSection } = await import("./OwnTeamSkillsSection");
const { teamSkillsCopy } = await import("../copy");

const PLATFORM = { teamId: "t1", name: "Plattform", isMember: true, canOpen: true };
const DRIFT = { teamId: "t2", name: "Drift", isMember: true, canOpen: true };

/** Synthetic competencies. `s5` is inactive and must not count in any progress figure. */
const PLATFORM_SKILLS = [
  { skillId: "s1", name: "API-design", description: "", category: "Backend", active: true, sortOrder: 1, criteriaVersion: 1, guidance: {} },
  { skillId: "s2", name: "Databaser", description: "", category: "Backend", active: true, sortOrder: 2, criteriaVersion: 1, guidance: {} },
  { skillId: "s3", name: "Tilgjengelighet", description: "", category: "Frontend", active: true, sortOrder: 3, criteriaVersion: 1, guidance: {} },
  { skillId: "s5", name: "Gammel praksis", description: "", category: "Frontend", active: false, sortOrder: 4, criteriaVersion: 1, guidance: {} },
];
const DRIFT_SKILLS = [
  { skillId: "x1", name: "Driftsikkerhet", description: "", category: null, active: true, sortOrder: 1, criteriaVersion: 1, guidance: {} },
  { skillId: "x2", name: "Overvåking", description: "", category: null, active: true, sortOrder: 2, criteriaVersion: 1, guidance: {} },
];

function listFor(teamId: string, own: { skillId: string; level: number; outdated: boolean }[] = []) {
  const skills = teamId === "t1" ? PLATFORM_SKILLS : DRIFT_SKILLS;
  return { status: "ok", skills, canEdit: false, own, truncated: false };
}

beforeEach(() => {
  fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [PLATFORM, DRIFT] });
  fetchTeamSkillsMock.mockImplementation(async (_token: string, teamId: string) => listFor(teamId));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderTeams() {
  render(<OwnTeamSkillsSection />);
  await screen.findByRole("heading", { name: teamSkillsCopy.own.teamHeading("Plattform") });
  await screen.findByRole("heading", { name: teamSkillsCopy.own.teamHeading("Drift") });
  return userEvent.setup();
}

function teamRegion(name: string) {
  return screen.getByRole("region", { name: teamSkillsCopy.own.teamHeading(name) });
}

describe("team-owned skills: per-team progress", () => {
  it("counts only active competencies and only in that team's own progress line", async () => {
    await renderTeams();

    expect(within(teamRegion("Plattform")).getByText("0 av 3 aktive kompetanser vurdert")).toBeTruthy();
    expect(within(teamRegion("Drift")).getByText("0 av 2 aktive kompetanser vurdert")).toBeTruthy();
  });
});

describe("team-owned skills: category expand and collapse all", () => {
  it("Vis alle opens every category of this team only, and Skjul alle closes them again", async () => {
    const user = await renderTeams();
    const platform = within(teamRegion("Plattform"));

    await user.click(platform.getByRole("button", { name: teamSkillsCopy.own.showAllCategories }));
    expect(platform.getByRole("button", { name: /^Backend/ }).getAttribute("aria-expanded")).toBe("true");
    expect(platform.getByRole("button", { name: /^Frontend/ }).getAttribute("aria-expanded")).toBe("true");
    expect(within(teamRegion("Drift")).queryByText("Driftsikkerhet")).toBeNull();

    await user.click(platform.getByRole("button", { name: teamSkillsCopy.own.hideAllCategories }));
    expect(platform.getByRole("button", { name: /^Backend/ }).getAttribute("aria-expanded")).toBe("false");
    expect(platform.getByRole("button", { name: /^Frontend/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("disables the expand and collapse controls while a search is active, and says why", async () => {
    const user = await renderTeams();
    const platform = within(teamRegion("Plattform"));

    await user.type(platform.getByRole("searchbox"), "databaser");

    expect((platform.getByRole("button", { name: teamSkillsCopy.own.showAllCategories }) as HTMLButtonElement).disabled).toBe(true);
    expect((platform.getByRole("button", { name: teamSkillsCopy.own.hideAllCategories }) as HTMLButtonElement).disabled).toBe(true);
    expect(platform.getByText(teamSkillsCopy.own.categoryControlsSearchNote)).toBeTruthy();
  });
});

describe("team-owned skills: filters are scoped to their team", () => {
  it("a status filter chosen in one team does not change the other team", async () => {
    const user = await renderTeams();

    await user.click(within(teamRegion("Plattform")).getByRole("button", { name: teamSkillsCopy.own.filterNotAssessed }));

    expect(within(teamRegion("Plattform")).getByRole("button", { name: teamSkillsCopy.own.filterNotAssessed }).getAttribute("aria-pressed")).toBe("true");
    expect(within(teamRegion("Drift")).getByRole("button", { name: teamSkillsCopy.own.filterAll }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("team-owned skills: a save keeps the person's category choice", () => {
  it("leaves an opened category open after a rating is saved", async () => {
    const rated = [{ skillId: "s1", level: 2, outdated: false }];
    setOwnTeamSkillRatingMock.mockResolvedValue({ status: "ok", skill: PLATFORM_SKILLS[0] });
    fetchTeamSkillsMock.mockImplementation(async (_token: string, teamId: string) => listFor(teamId, teamId === "t1" ? rated : []));
    const user = await renderTeams();
    const platform = within(teamRegion("Plattform"));

    await user.click(platform.getByRole("button", { name: /^Backend/ }));
    await user.click(platform.getByRole("radio", { name: "API-design: 2. Kan med støtte" }));

    expect(setOwnTeamSkillRatingMock).toHaveBeenCalled();
    expect(platform.getByRole("button", { name: /^Backend/ }).getAttribute("aria-expanded")).toBe("true");
  });
});

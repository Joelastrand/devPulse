// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Identity = string | null;
let identitySubscribers = new Set<(token: Identity) => void>();
vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: (callback: (token: Identity) => void) => {
    identitySubscribers.add(callback);
    callback("token-a");
    return () => {
      identitySubscribers.delete(callback);
    };
  },
}));

const fetchTeamsOverviewMock = vi.fn();
vi.mock("../../teams/client/teams-overview-gateway", () => ({ fetchTeamsOverview: fetchTeamsOverviewMock }));
const fetchTeamSkillsMock = vi.fn();
vi.mock("../client/team-skills-gateway", () => ({
  fetchTeamSkills: fetchTeamSkillsMock,
  setOwnTeamSkillRating: vi.fn(),
  clearOwnTeamSkillRating: vi.fn(),
}));

const { OwnTeamSkillsSection } = await import("./OwnTeamSkillsSection");
const { teamSkillsCopy } = await import("../copy");

const TEAM = { teamId: "t1", name: "Plattform", isMember: true, canOpen: true };

/** Two categories and one uncategorized competency. Names are synthetic. */
const SKILLS = [
  { skillId: "s1", name: "API-design", category: "Backend", active: true, guidance: {} },
  { skillId: "s2", name: "Databaser", category: "Backend", active: true, guidance: {} },
  { skillId: "s3", name: "Tilgjengelighet", category: "Frontend", active: true, guidance: {} },
  { skillId: "s4", name: "Diverse", category: null, active: true, guidance: {} },
];

beforeEach(() => {
  identitySubscribers = new Set();
  fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [TEAM] });
  fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: SKILLS, canEdit: false, own: [], truncated: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderSection() {
  render(<OwnTeamSkillsSection />);
  await screen.findByRole("heading", { name: teamSkillsCopy.own.teamHeading(TEAM.name) });
  return userEvent.setup();
}

function categoryButton(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}`) });
}

function searchBox() {
  return screen.getByRole("searchbox", { name: teamSkillsCopy.own.searchLabel(TEAM.name) });
}

describe("team-owned skills: category groups", () => {
  it("shows each category as a collapsed disclosure with its own count, and hides the skills until it is opened", async () => {
    const user = await renderSection();

    expect(categoryButton("Backend").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("API-design")).toBeNull();
    expect(screen.getByRole("button", { name: /Backend.*2 kompetanser/ })).toBeTruthy();

    await user.click(categoryButton("Backend"));

    expect(categoryButton("Backend").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("API-design")).toBeTruthy();
    expect(screen.queryByText("Tilgjengelighet")).toBeNull();
  });

  it("puts competencies without a category in a trailing 'Uten kategori' group", async () => {
    await renderSection();

    const names = screen.getAllByRole("button", { expanded: false }).map((button) => button.textContent ?? "");
    expect(names.at(-1)).toContain(teamSkillsCopy.own.uncategorized);
  });
});

describe("team-owned skills: search inside collapsed categories", () => {
  it("reveals a matching competency that sits in a closed category and reports the shown count", async () => {
    const user = await renderSection();

    await user.type(searchBox(), "databaser");

    expect(categoryButton("Backend").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Databaser")).toBeTruthy();
    expect(screen.queryByText("API-design")).toBeNull();
    expect(screen.getByText(teamSkillsCopy.own.resultCount(1, 4))).toBeTruthy();
  });

  it("keeps categories without a match out of the result list", async () => {
    const user = await renderSection();

    await user.type(searchBox(), "tilgjengelighet");

    expect(screen.queryByRole("button", { name: /Backend/ })).toBeNull();
    expect(categoryButton("Frontend").getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the no-matches message when the query matches nothing", async () => {
    const user = await renderSection();

    await user.type(searchBox(), "finnes-ikke");

    expect(screen.getByText(teamSkillsCopy.own.noSearchMatches)).toBeTruthy();
  });

  it("restores the user's own disclosure choices when the query is cleared, without the search having overwritten them", async () => {
    const user = await renderSection();
    await user.click(categoryButton("Frontend"));

    await user.type(searchBox(), "databaser");
    expect(screen.queryByRole("button", { name: /^Frontend/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: teamSkillsCopy.own.searchClear }));

    expect(categoryButton("Frontend").getAttribute("aria-expanded")).toBe("true");
    expect(categoryButton("Backend").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Databaser")).toBeNull();
  });
});

describe("team-owned skills: no cross-team leakage in search", () => {
  it("does not let one team's search change another team's list", async () => {
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [TEAM, { teamId: "t2", name: "Drift", isMember: true, canOpen: true }],
    });
    fetchTeamSkillsMock.mockImplementation(async (_token: string, teamId: string) =>
      teamId === "t1"
        ? { status: "ok", skills: SKILLS, canEdit: false, own: [], truncated: false }
        : { status: "ok", skills: [{ skillId: "x1", name: "Driftsikkerhet", category: null, active: true, guidance: {} }], canEdit: false, own: [], truncated: false },
    );
    const user = await renderSection();
    await screen.findByRole("heading", { name: teamSkillsCopy.own.teamHeading("Drift") });

    await user.type(searchBox(), "zzz");
    expect(screen.getByRole("searchbox", { name: teamSkillsCopy.own.searchLabel("Drift") })).toHaveProperty("value", "");

    expect(within(screen.getByRole("region", { name: teamSkillsCopy.own.teamHeading("Drift") })).getByText(/Viser 1 av 1/)).toBeTruthy();
  });
});

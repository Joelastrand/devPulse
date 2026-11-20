// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { skillCatalogCopy, skillProfileCopy } from "../copy";

const observeIdTokenMock = vi.fn();
const fetchOwnSkillsMock = vi.fn();
const fetchTeamsOverviewMock = vi.fn();
const fetchTeamSkillsMock = vi.fn();

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RadarChart: () => null,
  PolarGrid: () => null,
  PolarAngleAxis: () => null,
  PolarRadiusAxis: () => null,
  Radar: () => null,
}));
vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../client/skill-profile-gateway", () => ({ fetchOwnSkills: fetchOwnSkillsMock }));
vi.mock("../../teams/client/teams-overview-gateway", () => ({ fetchTeamsOverview: fetchTeamsOverviewMock }));
vi.mock("../../team-owned-skills/client/team-skills-gateway", () => ({ fetchTeamSkills: fetchTeamSkillsMock }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { SkillOverview } = await import("./SkillOverview");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** One team the person belongs to, with `active` competencies of which `assessed` are rated by the person. */
function teamWith(active: number, assessed: number) {
  const skills = Array.from({ length: active }, (_, index) => ({
    skillId: `k${index}`,
    name: `Kompetanse ${index + 1}`,
    description: "",
    category: null,
    guidance: {},
    criteriaVersion: 1,
    active: true,
    sortOrder: index,
  }));
  const own = skills.slice(0, assessed).map((skill, index) => ({ skillId: skill.skillId, level: (index % 4) + 1, outdated: false }));
  fetchTeamsOverviewMock.mockResolvedValue({
    status: "ok",
    teams: [{ teamId: "team-a", name: "Team A", isMember: true, relationship: "member", canOpen: true }],
  });
  fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills, canEdit: false, own, truncated: false });
}

/** Synthetic skill names; levels are the person's own self-assessments. */
async function renderWith(levels: (1 | 2 | 3 | 4 | null)[]) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  const skills = levels.map((level, index) => ({ treeId: `s${index}`, name: `Ferdighet ${index + 1}`, level }));
  fetchOwnSkillsMock.mockResolvedValue({ status: "ok", dto: { skills, truncated: false, profile: "ok" } });
  render(<SkillOverview />);
  await screen.findByRole("heading", { name: skillProfileCopy.overview.nextStepsHeading });
  return within(screen.getByRole("heading", { name: skillProfileCopy.overview.nextStepsHeading }).closest("section")!);
}

describe("SkillOverview: contextual next steps (only existing data is used)", () => {
  it("with no assessments, offers a first-assessment action and a start explanation", async () => {
    teamWith(0, 0);
    const panel = await renderWith([null, null]);

    expect(panel.getByText(skillProfileCopy.overview.startHint)).toBeTruthy();
    expect(panel.getByRole("link", { name: skillProfileCopy.overview.startAction }).getAttribute("href")).toBe("/me/skills?vy=rediger");
    expect(panel.queryByText(skillProfileCopy.overview.unassessedHint(2))).toBeNull();
  });

  it("with some skills unassessed, continues the personal assessment with an accurate count", async () => {
    teamWith(0, 0);
    const panel = await renderWith([3, null, null]);

    expect(panel.getByText(skillProfileCopy.overview.unassessedHint(2))).toBeTruthy();
    const primary = panel.getByRole("link", { name: skillProfileCopy.overview.continueAction });
    expect(primary.getAttribute("href")).toBe("/me/skills?vy=rediger");
    // Contrast regression: the primary action must use the design-system foreground token that exists for `--primary`.
    expect(primary.className).toContain("text-primary-text");
    expect(primary.className).not.toContain("text-text-inverse");
    expect(panel.queryByText(skillProfileCopy.overview.allAssessedHint)).toBeNull();
  });

  it("with every skill assessed and all team competencies assessed, offers a review action only", async () => {
    teamWith(2, 2);
    const panel = await renderWith([1, 4]);

    expect(panel.getByText(skillProfileCopy.overview.allAssessedHint)).toBeTruthy();
    expect(panel.queryByText(/ikke vurdert ennå/)).toBeNull();
    expect(panel.getByRole("link", { name: skillProfileCopy.overview.reviewAction })).toBeTruthy();
    expect(panel.queryByRole("link", { name: skillProfileCopy.overview.continueAction })).toBeNull();
  });

  it("with every personal skill assessed but a team competency still open, the single primary action is the team view", async () => {
    teamWith(3, 1);
    const panel = await renderWith([2, 3]);

    expect(await panel.findByText(skillCatalogCopy.team.nextStepHint)).toBeTruthy();
    expect(panel.getByRole("link", { name: skillCatalogCopy.team.summaryAction }).getAttribute("href")).toBe("/me/skills?vy=teamkompetanser");
    expect(panel.queryByRole("link", { name: skillProfileCopy.overview.reviewAction })).toBeNull();
  });
});

describe("SkillOverview: the team summary is informational, not a second action", () => {
  it("shows per-team progress and a single text link to the team view, never a second primary button", async () => {
    teamWith(3, 1);
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback("a-token");
      return () => {};
    });
    fetchOwnSkillsMock.mockResolvedValue({
      status: "ok",
      dto: {
        skills: [
          { treeId: "s0", name: "Ferdighet 1", level: 2 },
          { treeId: "s1", name: "Ferdighet 2", level: null },
        ],
        truncated: false,
        profile: "ok",
      },
    });
    render(<SkillOverview />);

    expect(await screen.findByText("1 av 3 vurdert")).toBeTruthy();
    expect(screen.getByText("Team A")).toBeTruthy();
    const teamLink = screen.getByRole("link", { name: skillCatalogCopy.team.summaryLink });
    expect(teamLink.getAttribute("href")).toBe("/me/skills?vy=teamkompetanser");
    expect(teamLink.className).not.toContain("bg-primary");
    // The personal assessment is incomplete (none of its skills left), so the one primary action is the personal one.
    expect(screen.queryByRole("link", { name: skillCatalogCopy.team.summaryAction })).toBeNull();
    expect(screen.getByRole("link", { name: skillProfileCopy.overview.continueAction })).toBeTruthy();
  });
});

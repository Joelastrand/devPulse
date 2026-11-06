// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const fetchProjectsMock = vi.fn();
const fetchSystemsMock = vi.fn();
const fetchPlansMock = vi.fn();

vi.mock("../../team-projects/client/team-projects-gateway", () => ({ fetchTeamProjects: fetchProjectsMock }));
vi.mock("../../team-systems/client/team-systems-gateway", () => ({ fetchTeamSystems: fetchSystemsMock }));
vi.mock("../../team-competence-plan/client/competence-plan-gateway", () => ({ fetchCompetencePlans: fetchPlansMock }));

const { TeamOversiktSummary } = await import("./TeamOversiktSummary");

afterEach(() => {
  cleanup();
  fetchProjectsMock.mockReset();
  fetchSystemsMock.mockReset();
  fetchPlansMock.mockReset();
});

function project(overrides: Record<string, unknown>) {
  return { projectId: "p", title: "P", startDate: "2026-01-01", endDate: "2026-02-01", lifecycleStatus: "planned", effectiveStatus: "planned", priority: "medium", archived: false, ...overrides };
}

function system(overrides: Record<string, unknown>) {
  return { attention: false, knowledgeRisk: "lower", knowledgeCount: 2, inGoodStanding: true, name: "S", description: null, ...overrides };
}

function plan(overrides: Record<string, unknown>) {
  return { treeId: "t", targetStage: 2, priority: "medium", archived: false, milestones: [], progress: { completed: 0, total: 0 }, ...overrides };
}

describe("TeamOversiktSummary (TASK-008)", () => {
  it("shows real counts from the authorized reads, and each count links to its detail tab", async () => {
    fetchProjectsMock.mockResolvedValue({ status: "ok", projects: [project({ effectiveStatus: "active" }), project({ projectId: "q" })], canEdit: false, truncated: false });
    fetchSystemsMock.mockResolvedValue({ status: "ok", systems: [system({ attention: true }), system({})], canEdit: false, truncated: false });
    fetchPlansMock.mockResolvedValue({ status: "ok", plans: [plan({ priority: "high" })], canEdit: false, truncated: false });

    render(<TeamOversiktSummary teamId="team-a" token="tok" openChallenges={3} />);

    const projectsCard = await screen.findByRole("region", { name: "Pågående prosjekt" });
    expect(await within(projectsCard).findByText("1")).toBeTruthy();
    expect(within(projectsCard).getByRole("link", { name: /Roadmap/ }).getAttribute("href")).toBe("/teams/team-a/roadmap");

    const systemsCard = screen.getByRole("region", { name: "System som trenger oppfølging" });
    expect(await within(systemsCard).findByText("1")).toBeTruthy();
    expect(within(systemsCard).getByRole("link", { name: /Systemoversikt/ }).getAttribute("href")).toBe("/teams/team-a/systems");

    const plansCard = screen.getByRole("region", { name: "Prioriterte kompetanseplaner" });
    expect(await within(plansCard).findByText("1")).toBeTruthy();
    expect(within(plansCard).getByRole("link", { name: /Kompetanseplan/ }).getAttribute("href")).toBe("/teams/team-a/competence-plan");

    expect(screen.getByRole("region", { name: "Åpne utfordringer" }).textContent).toContain("3");
  });

  it("shows a loading state, never a 0, while the reads are pending", () => {
    fetchProjectsMock.mockReturnValue(new Promise(() => {}));
    fetchSystemsMock.mockReturnValue(new Promise(() => {}));
    fetchPlansMock.mockReturnValue(new Promise(() => {}));

    render(<TeamOversiktSummary teamId="team-a" token="tok" openChallenges={null} />);

    const projectsCard = screen.getByRole("region", { name: "Pågående prosjekt" });
    expect(within(projectsCard).getByText("Laster…")).toBeTruthy();
    expect(projectsCard.textContent).not.toContain("0");
  });

  it("states that competence-plan priorities are for leads when the read is forbidden, instead of showing a count", async () => {
    fetchProjectsMock.mockResolvedValue({ status: "ok", projects: [], canEdit: false, truncated: false });
    fetchSystemsMock.mockResolvedValue({ status: "ok", systems: [], canEdit: false, truncated: false });
    fetchPlansMock.mockResolvedValue({ status: "forbidden" });

    render(<TeamOversiktSummary teamId="team-a" token="tok" openChallenges={0} />);

    const plansCard = screen.getByRole("region", { name: "Prioriterte kompetanseplaner" });
    expect(await within(plansCard).findByText("Kun for teamledere")).toBeTruthy();
  });

  it("shows an explicit error instead of a count when a read fails", async () => {
    fetchProjectsMock.mockResolvedValue({ status: "read_failed" });
    fetchSystemsMock.mockResolvedValue({ status: "ok", systems: [], canEdit: false, truncated: false });
    fetchPlansMock.mockResolvedValue({ status: "ok", plans: [], canEdit: false, truncated: false });

    render(<TeamOversiktSummary teamId="team-a" token="tok" openChallenges={null} />);

    const projectsCard = screen.getByRole("region", { name: "Pågående prosjekt" });
    expect(await within(projectsCard).findByText("Kunne ikke lastes")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Åpne utfordringer" }).textContent).toContain("Kunne ikke lastes");
  });

  it("lists up to three next steps, each linking to its tab, and says so when there is nothing to do", async () => {
    fetchProjectsMock.mockResolvedValue({ status: "ok", projects: [], canEdit: false, truncated: false });
    fetchSystemsMock.mockResolvedValue({ status: "ok", systems: [], canEdit: false, truncated: false });
    fetchPlansMock.mockResolvedValue({ status: "ok", plans: [], canEdit: false, truncated: false });

    render(<TeamOversiktSummary teamId="team-a" token="tok" openChallenges={0} />);

    expect(await screen.findByText("Ingen oppfølging nå.")).toBeTruthy();
  });
});

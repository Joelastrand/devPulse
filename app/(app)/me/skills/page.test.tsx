// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../../src/components/ui/heading-structure";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/me/skills" }));
vi.mock("../../../../src/features/skill-profiles/components/SkillOverview", () => ({
  SkillOverview: () => <div data-testid="skill-overview" />,
}));
vi.mock("../../../../src/features/skill-profiles/components/SkillProfilePage", () => ({
  SkillProfilePage: () => <div data-testid="skill-profile-page" />,
}));

vi.mock("../../../../src/features/team-owned-skills/components/OwnTeamSkillsSection", () => ({
  OwnTeamSkillsSection: () => <div data-testid="own-team-skills" />,
}));

vi.mock("../../../../src/features/team-skills/components/OwnCompetenceSharing", () => ({
  OwnCompetenceSharing: () => <div data-testid="own-competence-sharing" />,
}));

vi.mock("../../../../src/features/personal-role-workspace/components/RoleWorkspace", () => ({
  RoleWorkspace: () => <div data-testid="role-workspace" />,
}));

const { default: MySkillsPage } = await import("./page");

async function renderView(vy?: string) {
  const element = await MySkillsPage({ searchParams: Promise.resolve(vy === undefined ? {} : { vy }) });
  return render(element);
}

afterEach(cleanup);

describe("/me/skills page (route-backed views, ref 07)", () => {
  it("keeps its title and has no duplicate page-level nav (the sidebar owns Ferdigheter, Mål and Samtaler)", async () => {
    await renderView();
    expect(screen.getByRole("heading", { name: "Mine ferdigheter" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Personlig utvikling" })).toBeNull();
  });

  it("defaults to the Oversikt dashboard and does not render the editing form", async () => {
    await renderView();
    expect(screen.getByTestId("skill-overview")).toBeTruthy();
    expect(screen.queryByTestId("skill-profile-page")).toBeNull();
    expect(screen.queryByTestId("role-workspace")).toBeNull();
    expect(screen.queryByTestId("own-competence-sharing")).toBeNull();
  });

  it("lists the four views as links to ?vy=, with only the selected one marked as the current page", async () => {
    await renderView("rolle");
    const tabs = screen.getByRole("navigation", { name: "Visninger for ferdigheter" });
    const links = Array.from(tabs.querySelectorAll("a"));
    expect(links.map((link) => link.textContent)).toEqual(["Oversikt", "Kompetansekart", "Min rolle og mine bidrag", "Deling med team"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/me/skills?vy=oversikt",
      "/me/skills?vy=rediger",
      "/me/skills?vy=rolle",
      "/me/skills?vy=deling",
    ]);
    expect(links.filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent)).toEqual([
      "Min rolle og mine bidrag",
    ]);
  });

  it("renders only the Kompetansekart editing view for vy=rediger", async () => {
    await renderView("rediger");
    expect(screen.getByTestId("skill-profile-page")).toBeTruthy();
    expect(screen.queryByTestId("skill-overview")).toBeNull();
    expect(screen.queryByTestId("role-workspace")).toBeNull();
    expect(screen.queryByTestId("own-competence-sharing")).toBeNull();
  });

  it("renders only the private role workspace for vy=rolle", async () => {
    await renderView("rolle");
    expect(screen.getByTestId("role-workspace")).toBeTruthy();
    expect(screen.queryByTestId("skill-profile-page")).toBeNull();
    expect(screen.queryByTestId("own-competence-sharing")).toBeNull();
  });

  it("renders only the team-sharing preferences for vy=deling", async () => {
    await renderView("deling");
    expect(screen.getByTestId("own-competence-sharing")).toBeTruthy();
    expect(screen.queryByTestId("skill-overview")).toBeNull();
    expect(screen.queryByTestId("skill-profile-page")).toBeNull();
  });

  it("falls back to the overview for an unknown vy value, and keeps a known view for the next render", async () => {
    await renderView("ukjent");
    expect(screen.getByTestId("skill-overview")).toBeTruthy();
    cleanup();
    await renderView("rediger");
    expect(screen.getByTestId("skill-profile-page")).toBeTruthy();
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    await renderView();
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

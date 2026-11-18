// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { teamsCopy } from "../copy";

const usePathnameMock = vi.fn<() => string | null>(() => "/teams/team-1");

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

const { TeamRouteNav } = await import("./TeamRouteNav");

function renderAt(pathname: string | null, teamId = "team-1") {
  usePathnameMock.mockReturnValue(pathname);
  render(<TeamRouteNav teamId={teamId} />);
  const nav = screen.getByRole("navigation", { name: teamsCopy.nav.label });
  return {
    overview: within(nav).getByRole("link", { name: "Oversikt" }),
    roadmap: within(nav).getByRole("link", { name: "Roadmap" }),
    competencePlan: within(nav).getByRole("link", { name: "Kompetanseplan" }),
    competence: within(nav).getByRole("link", { name: "Teamkompetanse" }),
    systems: within(nav).getByRole("link", { name: "Systemoversikt" }),
    results: within(nav).getByRole("link", { name: "Resultater og trender" }),
    surveys: within(nav).getByRole("link", { name: "Undersøkelser" }),
    links: within(nav).getAllByRole("link"),
  };
}

describe("TeamRouteNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes exactly the seven team destinations in order", () => {
    const { links } = renderAt("/teams/team-1");

    expect(links.map((link) => link.textContent)).toEqual([
      "Oversikt",
      "Roadmap",
      "Kompetanseplan",
      "Teamkompetanse",
      "Systemoversikt",
      "Resultater og trender",
      "Undersøkelser",
    ]);
  });

  it("links all seven tabs to their routes", () => {
    const { overview, roadmap, competencePlan, competence, systems, results, surveys } = renderAt("/teams/team-1");

    expect(overview.getAttribute("href")).toBe("/teams/team-1");
    expect(roadmap.getAttribute("href")).toBe("/teams/team-1/roadmap");
    expect(competencePlan.getAttribute("href")).toBe("/teams/team-1/competence-plan");
    expect(competence.getAttribute("href")).toBe("/teams/team-1/competence");
    expect(systems.getAttribute("href")).toBe("/teams/team-1/systems");
    expect(results.getAttribute("href")).toBe("/teams/team-1/results");
    expect(surveys.getAttribute("href")).toBe("/teams/team-1/surveys");
  });

  it("encodes the teamId in every href", () => {
    const { overview, roadmap, results, surveys } = renderAt("/teams/a%20b", "a b");

    expect(overview.getAttribute("href")).toBe("/teams/a%20b");
    expect(roadmap.getAttribute("href")).toBe("/teams/a%20b/roadmap");
    expect(results.getAttribute("href")).toBe("/teams/a%20b/results");
    expect(surveys.getAttribute("href")).toBe("/teams/a%20b/surveys");
    expect(overview.getAttribute("aria-current")).toBe("page");
  });

  it("marks only Oversikt current on the overview route", () => {
    const { overview, roadmap, systems } = renderAt("/teams/team-1");
    expect(systems.hasAttribute("aria-current")).toBe(false);

    expect(overview.getAttribute("aria-current")).toBe("page");
    expect(roadmap.hasAttribute("aria-current")).toBe(false);
  });

  it("marks only Roadmap current on the roadmap route", () => {
    const { overview, roadmap } = renderAt("/teams/team-1/roadmap");

    expect(roadmap.getAttribute("aria-current")).toBe("page");
    expect(overview.hasAttribute("aria-current")).toBe(false);
  });

  it("marks only Resultater og trender current on the results route", () => {
    const { overview, results, surveys } = renderAt("/teams/team-1/results");

    expect(results.getAttribute("aria-current")).toBe("page");
    expect(overview.hasAttribute("aria-current")).toBe(false);
    expect(surveys.hasAttribute("aria-current")).toBe(false);
  });

  it("marks only Undersøkelser current on the surveys route", () => {
    const { results, surveys } = renderAt("/teams/team-1/surveys");

    expect(surveys.getAttribute("aria-current")).toBe("page");
    expect(results.hasAttribute("aria-current")).toBe(false);
  });

  it("ignores a single trailing slash", () => {
    const { overview, roadmap } = renderAt("/teams/team-1/roadmap/");

    expect(roadmap.getAttribute("aria-current")).toBe("page");
    expect(overview.hasAttribute("aria-current")).toBe(false);
  });

  it.each(["/teams/team-1/forum/t1", "/teams/team-1/roadmap/extra", "/teams/team-1/results/extra", "/teams/other", "/unknown", null])(
    "marks nothing current on %s",
    (pathname) => {
      const { overview, roadmap, results, surveys } = renderAt(pathname);

      expect(overview.hasAttribute("aria-current")).toBe(false);
      expect(roadmap.hasAttribute("aria-current")).toBe(false);
      expect(results.hasAttribute("aria-current")).toBe(false);
      expect(surveys.hasAttribute("aria-current")).toBe(false);
    },
  );
});

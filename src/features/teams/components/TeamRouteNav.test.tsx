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
    links: within(nav).getAllByRole("link"),
  };
}

describe("TeamRouteNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes exactly the six team tabs in order — no Forum or other destination", () => {
    const { links } = renderAt("/teams/team-1");

    expect(links.map((link) => link.textContent)).toEqual([
      "Oversikt",
      "Roadmap",
      "Kompetanseplan",
      "Teamkompetanse",
      "Systemoversikt",
      "Kompetanser",
    ]);
  });

  it("links all five tabs to their routes", () => {
    const { overview, roadmap, competencePlan, competence, systems } = renderAt("/teams/team-1");
    expect(systems.hasAttribute("aria-current")).toBe(false);

    expect(overview.getAttribute("href")).toBe("/teams/team-1");
    expect(roadmap.getAttribute("href")).toBe("/teams/team-1/roadmap");
    expect(competencePlan.getAttribute("href")).toBe("/teams/team-1/competence-plan");
    expect(competence.getAttribute("href")).toBe("/teams/team-1/competence");
    expect(systems.getAttribute("href")).toBe("/teams/team-1/systems");
  });

  it("encodes the teamId in both hrefs", () => {
    const { overview, roadmap } = renderAt("/teams/a%20b", "a b");

    expect(overview.getAttribute("href")).toBe("/teams/a%20b");
    expect(roadmap.getAttribute("href")).toBe("/teams/a%20b/roadmap");
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

  it("ignores a single trailing slash", () => {
    const { overview, roadmap } = renderAt("/teams/team-1/roadmap/");

    expect(roadmap.getAttribute("aria-current")).toBe("page");
    expect(overview.hasAttribute("aria-current")).toBe(false);
  });

  it.each(["/teams/team-1/forum/t1", "/teams/team-1/roadmap/extra", "/teams/other", "/unknown", null])(
    "marks nothing current on %s",
    (pathname) => {
      const { overview, roadmap } = renderAt(pathname);

      expect(overview.hasAttribute("aria-current")).toBe(false);
      expect(roadmap.hasAttribute("aria-current")).toBe(false);
    },
  );
});

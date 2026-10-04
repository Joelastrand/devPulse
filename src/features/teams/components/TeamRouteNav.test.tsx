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
    links: within(nav).getAllByRole("link"),
  };
}

describe("TeamRouteNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes exactly Oversikt and Roadmap — no Kompetanse, Forum or other destination", () => {
    const { links } = renderAt("/teams/team-1");

    expect(links.map((link) => link.textContent)).toEqual(["Oversikt", "Roadmap"]);
  });

  it("links Oversikt to the team route and Roadmap to its roadmap route", () => {
    const { overview, roadmap } = renderAt("/teams/team-1");

    expect(overview.getAttribute("href")).toBe("/teams/team-1");
    expect(roadmap.getAttribute("href")).toBe("/teams/team-1/roadmap");
  });

  it("encodes the teamId in both hrefs", () => {
    const { overview, roadmap } = renderAt("/teams/a%20b", "a b");

    expect(overview.getAttribute("href")).toBe("/teams/a%20b");
    expect(roadmap.getAttribute("href")).toBe("/teams/a%20b/roadmap");
    expect(overview.getAttribute("aria-current")).toBe("page");
  });

  it("marks only Oversikt current on the overview route", () => {
    const { overview, roadmap } = renderAt("/teams/team-1");

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

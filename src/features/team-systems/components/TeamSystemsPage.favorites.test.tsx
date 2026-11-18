// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamSystemView } from "../server/list-team-systems";
import { systemsCopy } from "../copy";
import { navigationState } from "./systems-navigation-test-helper";

const mocks = vi.hoisted(() => ({
  fetchTeamSystems: vi.fn(),
  fetchAssignableMembers: vi.fn(),
  fetchSystemFavorites: vi.fn(),
  setSystemFavorite: vi.fn(),
}));

vi.mock("next/navigation", async () => (await import("./systems-navigation-test-helper")).navigationMock);

vi.mock("../../teams/client/teams-overview-gateway", () => ({
  fetchTeamsOverview: async () => ({ status: "ok", teams: [{ teamId: "team-1", name: "Team Alfa" }] }),
}));

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const React = await import("react");
  return {
    useAuthGatedResource: (onAuthChange: (token: string | null, generation: number, current: () => boolean) => void) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      React.useEffect(() => {
        onAuthChange("token-abc", 1, () => true);
      }, []);
      return { isCurrentGeneration: () => true };
    },
  };
});

vi.mock("../client/team-systems-gateway", () => ({
  fetchTeamSystems: (...args: unknown[]) => mocks.fetchTeamSystems(...args),
  fetchAssignableMembers: (...args: unknown[]) => mocks.fetchAssignableMembers(...args),
  createTeamSystem: vi.fn(),
  updateTeamSystem: vi.fn(),
}));

vi.mock("../client/system-favorites-gateway", () => ({
  fetchSystemFavorites: (...args: unknown[]) => mocks.fetchSystemFavorites(...args),
  setSystemFavorite: (...args: unknown[]) => mocks.setSystemFavorite(...args),
}));

const { TeamSystemsPage } = await import("./TeamSystemsPage");

const NOT_ASSESSED = { value: "ikke_vurdert" as const, note: null, assessedAt: null };

function system(index: number, systemType: TeamSystemView["classification"]["systemType"]): TeamSystemView {
  return {
    systemId: `sys-${index}`,
    name: `System ${String(index).padStart(2, "0")}`,
    description: null,
    backstageUrl: null,
    classification: { systemType, businessCriticality: "hoy", userReach: "flere_avdelinger" },
    assessments: {
      availability: NOT_ASSESSED,
      reliability: NOT_ASSESSED,
      maintainability: NOT_ASSESSED,
      security: NOT_ASSESSED,
      testability: NOT_ASSESSED,
      deployability: NOT_ASSESSED,
      observability: NOT_ASSESSED,
    },
    knowledge: [],
    knowledgeRisk: "none",
    attention: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Twelve systems: odd numbers external, even numbers internal. */
const SYSTEMS = Array.from({ length: 12 }, (_, index) => system(index + 1, (index + 1) % 2 === 0 ? "internt" : "eksternt"));

async function renderPage(favoriteIds: string[]) {
  mocks.fetchTeamSystems.mockResolvedValue({ status: "ok", systems: SYSTEMS, canEdit: false, truncated: false });
  mocks.fetchAssignableMembers.mockResolvedValue({ status: "ok", members: [] });
  mocks.fetchSystemFavorites.mockResolvedValue({ status: "ok", systemIds: favoriteIds });
  render(<TeamSystemsPage teamId="team-1" />);
  await screen.findByRole("heading", { level: 1, name: "Team Alfa" });
  // Favorites are ready when at least one star is enabled. The table and the card list both render every visible star.
  await waitFor(() => expect(screen.getAllByRole("button", { name: /favoritt/ }).some((button) => !(button as HTMLButtonElement).disabled)).toBe(true));
}

/** The first star for a system: the table and the card list each render one, so a single match is taken from the table. */
function star(label: string): HTMLButtonElement {
  return screen.getAllByRole("button", { name: label })[0] as HTMLButtonElement;
}

function listedNames(): string[] {
  const list = screen.getByRole("list", { name: "Systemer i teamet" });
  return within(list)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent ?? "");
}

beforeEach(() => {
  navigationState.search = "";
  navigationState.replace.mockReset();
  mocks.setSystemFavorite.mockReset();
});

afterEach(() => {
  cleanup();
  mocks.fetchTeamSystems.mockReset();
  mocks.fetchSystemFavorites.mockReset();
});

describe("Systemoversikt favorites (Phase 2F.1)", () => {
  it("shows a favorite as a filled star with the removal label, and an unfavorited system with the add label", async () => {
    await renderPage(["sys-2"]);
    expect(star("Fjern favoritt: System 02")).toBeTruthy();
    expect(star("Legg til favoritt: System 01")).toBeTruthy();
  });

  it("changes the star only after the server confirms the write", async () => {
    await renderPage([]);
    let confirm!: (value: { ok: true; favorite: boolean }) => void;
    mocks.setSystemFavorite.mockReturnValue(new Promise((resolve) => (confirm = resolve)));

    await userEvent.click(star("Legg til favoritt: System 01"));
    expect(mocks.setSystemFavorite).toHaveBeenCalledWith("token-abc", "team-1", "sys-1", true);
    expect(star("Legg til favoritt: System 01").disabled).toBe(true);

    confirm({ ok: true, favorite: true });
    expect(await waitFor(() => expect(star("Fjern favoritt: System 01")).toBeTruthy())).toBeTruthy();
  });

  it("shows the refusal and leaves the star as it was when the server refuses", async () => {
    await renderPage([]);
    mocks.setSystemFavorite.mockResolvedValue({ ok: false, error: "forbidden" });

    await userEvent.click(star("Legg til favoritt: System 01"));

    expect(await screen.findByText(systemsCopy.favorites.writeError.forbidden)).toBeTruthy();
    expect(star("Legg til favoritt: System 01")).toBeTruthy();
  });

  it("filters to the caller's favorites with Kun favoritter and writes that state to the URL", async () => {
    await renderPage(["sys-2", "sys-5"]);

    await userEvent.click(screen.getByRole("button", { name: systemsCopy.filters.favoritesOnly }));

    expect(listedNames()).toEqual(["System 02", "System 05"]);
    expect(navigationState.replace).toHaveBeenLastCalledWith("/teams/team-1/systems?favoritter=1", { scroll: false });
  });

  it("restores the favorites switch, the placement filter and the rows shown from the URL on load", async () => {
    navigationState.search = "favoritter=1&plassering=internt&vis=20";
    await renderPage(["sys-2", "sys-4", "sys-5"]);

    expect(listedNames()).toEqual(["System 02", "System 04"]);
    expect(screen.getByText("Viser 2 av 2 systemer")).toBeTruthy();
  });

  it("shows an error and no favorite state when the favorites cannot be loaded", async () => {
    mocks.fetchTeamSystems.mockResolvedValue({ status: "ok", systems: SYSTEMS, canEdit: false, truncated: false });
    mocks.fetchAssignableMembers.mockResolvedValue({ status: "ok", members: [] });
    mocks.fetchSystemFavorites.mockResolvedValue({ status: "read_failed" });
    render(<TeamSystemsPage teamId="team-1" />);

    expect(await screen.findByText(systemsCopy.favorites.loadError)).toBeTruthy();
    expect(star("Legg til favoritt: System 01").disabled).toBe(true);
  });
});

describe("Systemoversikt browsing state in the URL (Phase 2F.1)", () => {
  it("restores a search and the rows shown from the URL", async () => {
    navigationState.search = "q=System%201&vis=20";
    await renderPage([]);
    // "System 10" through "System 12" match: three systems, all shown.
    expect(screen.getByText("Viser 3 av 3 systemer")).toBeTruthy();
    expect(listedNames()).toEqual(["System 10", "System 11", "System 12"]);
  });

  it("keeps the expanded row count after Vis flere, and writes it to the URL", async () => {
    mocks.fetchTeamSystems.mockResolvedValue({
      status: "ok",
      systems: Array.from({ length: 30 }, (_, index) => system(index + 1, "internt")),
      canEdit: false,
      truncated: false,
    });
    mocks.fetchAssignableMembers.mockResolvedValue({ status: "ok", members: [] });
    mocks.fetchSystemFavorites.mockResolvedValue({ status: "ok", systemIds: [] });
    render(<TeamSystemsPage teamId="team-1" />);
    await screen.findByRole("heading", { level: 1, name: "Team Alfa" });

    await userEvent.click(screen.getByRole("button", { name: systemsCopy.list.showMore }));
    await userEvent.click(screen.getByRole("button", { name: systemsCopy.list.showMore }));

    expect(screen.getByText("Viser 30 av 30 systemer")).toBeTruthy();
    expect(navigationState.replace).toHaveBeenLastCalledWith("/teams/team-1/systems?vis=30", { scroll: false });
  });

  it("returns the URL to the bare list path when every filter is reset", async () => {
    navigationState.search = "q=System&plassering=eksternt";
    await renderPage([]);

    await userEvent.click(screen.getAllByRole("button", { name: systemsCopy.list.resetFilters })[0]);

    expect(navigationState.replace).toHaveBeenLastCalledWith("/teams/team-1/systems", { scroll: false });
  });

  it("gives each row a detail link that carries the current list state", async () => {
    navigationState.search = "plassering=eksternt";
    await renderPage([]);

    const link = screen.getAllByRole("link", { name: "Detaljer: System 01" })[0];
    expect(link.getAttribute("href")).toBe(`/teams/team-1/systems/sys-1?from=${encodeURIComponent("plassering=eksternt")}`);
  });

  it("ignores hostile or malformed URL state and shows the default list", async () => {
    navigationState.search = "plassering=%3Cscript%3E&vis=7&favoritter=yes";
    await renderPage([]);
    // Unknown placement, invalid page size and a non-"1" favorites value all fall back: the first ten of all twelve systems.
    expect(screen.getByText("Viser 10 av 12 systemer")).toBeTruthy();
    expect(screen.getByRole("button", { name: systemsCopy.filters.favoritesOnly }).getAttribute("aria-pressed")).toBe("false");
  });
});

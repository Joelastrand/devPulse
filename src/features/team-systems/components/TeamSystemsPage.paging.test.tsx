// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamSystemView } from "../server/list-team-systems";
import { systemsCopy } from "../copy";

const fetchTeamSystemsMock = vi.fn();

vi.mock("next/navigation", async () => (await import("./systems-navigation-test-helper")).navigationMock);

vi.mock("../client/system-favorites-gateway", () => ({
  fetchSystemFavorites: vi.fn(async () => ({ status: "ok", systemIds: [] })),
  setSystemFavorite: vi.fn(),
}));

vi.mock("../../teams/client/teams-overview-gateway", () => ({
  fetchTeamsOverview: async () => ({
    status: "ok",
    teams: [{ teamId: "team-1", name: "Team Alfa" }],
  }),
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
  fetchTeamSystems: (...args: unknown[]) => fetchTeamSystemsMock(...args),
  fetchAssignableMembers: vi.fn(),
  createTeamSystem: vi.fn(),
  updateTeamSystem: vi.fn(),
}));

const { TeamSystemsPage } = await import("./TeamSystemsPage");

const NOT_ASSESSED = { value: "ikke_vurdert" as const, note: null, assessedAt: null };

function system(index: number, overrides: Partial<TeamSystemView> = {}): TeamSystemView {
  const name = `System ${String(index).padStart(2, "0")}`;
  return {
    systemId: `sys-${index}`,
    name,
    description: null,
    backstageUrl: null,
    classification: { systemType: "internt", businessCriticality: "hoy", userReach: "flere_avdelinger" },
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
    ...overrides,
  };
}

function manySystems(count: number): TeamSystemView[] {
  return Array.from({ length: count }, (_, index) => system(index + 1));
}

async function renderWith(systems: TeamSystemView[]) {
  fetchTeamSystemsMock.mockResolvedValue({ status: "ok", systems, canEdit: false, truncated: false });
  render(<TeamSystemsPage teamId="team-1" />);
  await screen.findByRole("heading", { level: 1, name: "Team Alfa" });
}

function listedNames(): string[] {
  const list = screen.getByRole("list", { name: "Systemer i teamet" });
  return within(list)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent ?? "");
}

afterEach(() => {
  cleanup();
  fetchTeamSystemsMock.mockReset();
});

describe("Systemoversikt progressive disclosure", () => {
  it("shows the first ten matches of a 30-system team and says how many exist", async () => {
    await renderWith(manySystems(30));

    expect(screen.getByText("Viser 10 av 30 systemer")).toBeTruthy();
    expect(listedNames()).toHaveLength(10);
  });

  it("reveals the next page of systems through an accessible Vis flere control", async () => {
    await renderWith(manySystems(30));

    await userEvent.click(screen.getByRole("button", { name: systemsCopy.list.showMore }));

    expect(screen.getByText("Viser 20 av 30 systemer")).toBeTruthy();
    expect(listedNames()).toHaveLength(20);
  });

  it("hides the Vis flere control when every match is already shown", async () => {
    await renderWith(manySystems(4));

    expect(screen.getByText("Viser 4 av 4 systemer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: systemsCopy.list.showMore })).toBeNull();
  });

  it("counts only the matches of an active search and starts again from the first page", async () => {
    await renderWith(manySystems(30));
    await userEvent.click(screen.getByRole("button", { name: systemsCopy.list.showMore }));

    await userEvent.type(screen.getByRole("searchbox", { name: systemsCopy.search.label }), "System 1");

    // "System 10" … "System 19" are the ten matches; the page resets to the first page, so all ten fit and no control remains.
    expect(screen.getByText("Viser 10 av 10 systemer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: systemsCopy.list.showMore })).toBeNull();
  });
});

describe("Systemoversikt filter summary and reset", () => {
  it("shows the active filter count and resets every filter with one control", async () => {
    await renderWith(manySystems(12));
    await userEvent.type(screen.getByRole("searchbox", { name: systemsCopy.search.label }), "System 0");

    expect(screen.getByText(systemsCopy.list.activeFilters(1))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: systemsCopy.list.resetFilters }));

    expect(screen.getByRole("searchbox", { name: systemsCopy.search.label }).getAttribute("value")).toBe("");
    expect(screen.getByText("Viser 10 av 12 systemer")).toBeTruthy();
    expect(screen.queryByText(systemsCopy.list.activeFilters(1))).toBeNull();
  });

  it("offers the reset control from the no-match state", async () => {
    await renderWith(manySystems(3));
    await userEvent.type(screen.getByRole("searchbox", { name: systemsCopy.search.label }), "finnes-ikke");

    expect(screen.getByText(systemsCopy.empty.noSearchResultsTitle)).toBeTruthy();
    // Two controls exist here by design: the filter summary and the empty state. Either one resets the filters.
    const resetButtons = screen.getAllByRole("button", { name: systemsCopy.list.resetFilters });
    expect(resetButtons).toHaveLength(2);
    await userEvent.click(resetButtons[1]);
    expect(screen.getByText("Viser 3 av 3 systemer")).toBeTruthy();
  });
});

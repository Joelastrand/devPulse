// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamSystemView } from "../server/list-team-systems";
import { systemsCopy } from "../copy";

const fetchTeamSystemsMock = vi.fn();
const fetchAssignableMembersMock = vi.fn();
const createTeamSystemMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams/team-1/systems",
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
      // The real hook reports auth state from an effect; mirror that so state updates never run during render.
      // Runs once per mount, like the real hook's subscription; the callback identity is intentionally not a dependency.
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
  fetchAssignableMembers: (...args: unknown[]) => fetchAssignableMembersMock(...args),
  createTeamSystem: (...args: unknown[]) => createTeamSystemMock(...args),
  updateTeamSystem: vi.fn(),
}));

const { TeamSystemsPage } = await import("./TeamSystemsPage");

function system(overrides: Partial<TeamSystemView> & { name: string }): TeamSystemView {
  const assessed = { value: "ikke_vurdert" as const, note: null, assessedAt: null };
  return {
    systemId: `sys-${overrides.name}`,
    description: null,
    backstageUrl: null,
    assessments: {
      availability: assessed,
      reliability: assessed,
      maintainability: assessed,
      security: assessed,
      testability: assessed,
      deployability: assessed,
      observability: assessed,
    },
    knowledge: [],
    knowledgeRisk: "none",
    attention: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function okResult(systems: TeamSystemView[], canEdit = true) {
  return { status: "ok", systems, canEdit, truncated: false };
}

afterEach(() => {
  cleanup();
  fetchTeamSystemsMock.mockReset();
  fetchAssignableMembersMock.mockReset();
  createTeamSystemMock.mockReset();
});

describe("TeamSystemsPage — loaded inventory", () => {
  it("renders the page heading, navigation and the authorized systems", async () => {
    fetchTeamSystemsMock.mockResolvedValue(
      okResult([
        system({ name: "Saksportalen", description: "Saksbehandling og arkiv" }),
        system({ name: "Dataplattform" }),
      ]),
    );
    render(<TeamSystemsPage teamId="team-1" />);

    expect(await screen.findByRole("heading", { level: 1, name: "Team Alfa" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Teamnavigasjon" })).toBeTruthy();
    expect(screen.getAllByText("Saksportalen").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dataplattform").length).toBeGreaterThan(0);
  });

  it("shows a Backstage link with safe target and an accessible name naming the system", async () => {
    fetchTeamSystemsMock.mockResolvedValue(
      okResult([system({ name: "Saksportalen", backstageUrl: "https://backstage.example.test/catalog/x" })]),
    );
    render(<TeamSystemsPage teamId="team-1" />);

    const link = (await screen.findAllByRole("link", { name: "Åpne Saksportalen i Backstage (åpnes i ny fane)" }))[0];
    expect(link.getAttribute("href")).toBe("https://backstage.example.test/catalog/x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("says plainly when no Backstage URL is configured instead of a dead link", async () => {
    fetchTeamSystemsMock.mockResolvedValue(okResult([system({ name: "Ny" })]));
    render(<TeamSystemsPage teamId="team-1" />);

    expect((await screen.findAllByText(systemsCopy.empty.noBackstageLink)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Åpne Ny i Backstage/ })).toBeNull();
  });

  it("shows summary counts derived from the loaded list only", async () => {
    const good = { value: "god" as const, note: null, assessedAt: null };
    fetchTeamSystemsMock.mockResolvedValue(
      okResult([
        system({
          name: "A",
          assessments: {
            availability: good,
            reliability: good,
            maintainability: good,
            security: good,
            testability: good,
            deployability: good,
            observability: good,
          },
        }),
        system({
          name: "B",
          attention: true,
          assessments: {
            availability: { value: "kritisk", note: null, assessedAt: null },
            reliability: { value: "ikke_vurdert", note: null, assessedAt: null },
            maintainability: { value: "ikke_vurdert", note: null, assessedAt: null },
            security: { value: "ikke_vurdert", note: null, assessedAt: null },
            testability: { value: "ikke_vurdert", note: null, assessedAt: null },
            deployability: { value: "ikke_vurdert", note: null, assessedAt: null },
            observability: { value: "ikke_vurdert", note: null, assessedAt: null },
          },
        }),
      ]),
    );
    render(<TeamSystemsPage teamId="team-1" />);

    const cards = within(await screen.findByRole("list", { name: "Oppsummering" })).getAllByRole("listitem");
    expect(cards[0].textContent).toContain("2");
    expect(cards[1].textContent).toContain("1");
    expect(cards[2].textContent).toContain("1");
  });

  it("filters the list by search text without any network call", async () => {
    const user = userEvent.setup();
    fetchTeamSystemsMock.mockResolvedValue(
      okResult([system({ name: "Saksportalen" }), system({ name: "Dataplattform" })]),
    );
    render(<TeamSystemsPage teamId="team-1" />);

    await screen.findAllByText("Saksportalen");
    await user.type(screen.getByRole("searchbox", { name: systemsCopy.search.label }), "data");

    expect(screen.queryAllByText("Saksportalen")).toHaveLength(0);
    expect(screen.getAllByText("Dataplattform").length).toBeGreaterThan(0);
    expect(fetchTeamSystemsMock).toHaveBeenCalledTimes(1);
  });

  it("shows a no-results message when filters match nothing", async () => {
    const user = userEvent.setup();
    fetchTeamSystemsMock.mockResolvedValue(okResult([system({ name: "Saksportalen" })]));
    render(<TeamSystemsPage teamId="team-1" />);

    await screen.findAllByText("Saksportalen");
    await user.type(screen.getByRole("searchbox", { name: systemsCopy.search.label }), "finnes-ikke");

    expect(screen.getByText(systemsCopy.empty.noSearchResultsTitle)).toBeTruthy();
  });
});

describe("TeamSystemsPage — states and write access", () => {
  it("shows a meaningful empty state with no invented records", async () => {
    fetchTeamSystemsMock.mockResolvedValue(okResult([]));
    render(<TeamSystemsPage teamId="team-1" />);

    expect(await screen.findByText(systemsCopy.empty.noSystemsTitle)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("offers the add-system action only when the server says the caller can edit", async () => {
    fetchTeamSystemsMock.mockResolvedValue(okResult([system({ name: "Saksportalen" })], false));
    render(<TeamSystemsPage teamId="team-1" />);

    await screen.findAllByText("Saksportalen");
    expect(screen.queryByRole("button", { name: systemsCopy.addSystem })).toBeNull();
  });

  it("shows the add-system action for editors", async () => {
    fetchTeamSystemsMock.mockResolvedValue(okResult([system({ name: "Saksportalen" })], true));
    render(<TeamSystemsPage teamId="team-1" />);

    expect(await screen.findByRole("button", { name: systemsCopy.addSystem })).toBeTruthy();
  });

  it("shows a read error with a retry action that refetches", async () => {
    const user = userEvent.setup();
    fetchTeamSystemsMock.mockResolvedValueOnce({ status: "read_failed" }).mockResolvedValueOnce(okResult([system({ name: "Etter" })]));
    render(<TeamSystemsPage teamId="team-1" />);

    expect(await screen.findByText(systemsCopy.readError)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: systemsCopy.retry }));
    await waitFor(() => expect(screen.getAllByText("Etter").length).toBeGreaterThan(0));
  });

  it("shows the forbidden message without any system data", async () => {
    fetchTeamSystemsMock.mockResolvedValue({ status: "forbidden" });
    render(<TeamSystemsPage teamId="team-1" />);

    expect(await screen.findByText(systemsCopy.forbidden)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

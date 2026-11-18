// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamSystemView } from "../server/list-team-systems";
import { systemsCopy } from "../copy";

const fetchTeamSystemsMock = vi.fn();
const fetchAssignableMembersMock = vi.fn();

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
  fetchAssignableMembers: (...args: unknown[]) => fetchAssignableMembersMock(...args),
  createTeamSystem: vi.fn(),
  updateTeamSystem: vi.fn(),
}));

const { TeamSystemDetailPage } = await import("./TeamSystemDetailPage");

const NOT_ASSESSED = { value: "ikke_vurdert" as const, note: null, assessedAt: null };

function system(overrides: Partial<TeamSystemView> & { name: string }): TeamSystemView {
  return {
    systemId: `sys-${overrides.name}`,
    description: "Synlig beskrivelse",
    backstageUrl: null,
    classification: { systemType: "internt", businessCriticality: "hoy", userReach: "flere_avdelinger" },
    assessments: {
      availability: NOT_ASSESSED,
      reliability: NOT_ASSESSED,
      maintainability: NOT_ASSESSED,
      security: { value: "kritisk", note: null, assessedAt: null },
      testability: NOT_ASSESSED,
      deployability: NOT_ASSESSED,
      observability: NOT_ASSESSED,
    },
    knowledge: [],
    knowledgeRisk: "none",
    attention: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderDetail(systemId: string) {
  render(<TeamSystemDetailPage teamId="team-1" systemId={systemId} />);
}

beforeEach(() => {
  fetchAssignableMembersMock.mockResolvedValue({ status: "ok", members: [] });
});

afterEach(() => {
  cleanup();
  fetchTeamSystemsMock.mockReset();
  fetchAssignableMembersMock.mockReset();
});

describe("TeamSystemDetailPage (/teams/[teamId]/systems/[systemId])", () => {
  it("shows the system's name, description, classification and assessments", async () => {
    fetchTeamSystemsMock.mockResolvedValue({ status: "ok", systems: [system({ name: "Kontroll" })], canEdit: true, truncated: false });
    renderDetail("sys-Kontroll");

    expect(await screen.findByRole("heading", { name: "Kontroll" })).toBeTruthy();
    expect(screen.getByText("Synlig beskrivelse")).toBeTruthy();
    expect(screen.getByText(/Internt/)).toBeTruthy();
    const securityRow = screen.getByText("Sikkerhet").closest("li") as HTMLElement;
    expect(within(securityRow).getByText("Kritisk")).toBeTruthy();
  });

  it("links back to Systemoversikt with a Norwegian label", async () => {
    fetchTeamSystemsMock.mockResolvedValue({ status: "ok", systems: [system({ name: "Kontroll" })], canEdit: false, truncated: false });
    renderDetail("sys-Kontroll");

    await screen.findByRole("heading", { name: "Kontroll" });
    const back = screen.getByRole("link", { name: systemsCopy.detail.back });
    expect(back.getAttribute("href")).toBe("/teams/team-1/systems");
  });

  it("shows a not-found state when the system is not in the team's list", async () => {
    fetchTeamSystemsMock.mockResolvedValue({ status: "ok", systems: [system({ name: "Annet" })], canEdit: true, truncated: false });
    renderDetail("sys-Ukjent");

    expect(await screen.findByText(systemsCopy.detail.missingTitle)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Annet" })).toBeNull();
  });

  it("shows the forbidden message without any system data", async () => {
    fetchTeamSystemsMock.mockResolvedValue({ status: "forbidden" });
    renderDetail("sys-Kontroll");

    expect(await screen.findByText(systemsCopy.forbidden)).toBeTruthy();
    expect(screen.queryByText("Synlig beskrivelse")).toBeNull();
  });

  it("offers a retry after a failed read and refetches", async () => {
    fetchTeamSystemsMock.mockResolvedValueOnce({ status: "read_failed" });
    fetchTeamSystemsMock.mockResolvedValueOnce({ status: "ok", systems: [system({ name: "Kontroll" })], canEdit: false, truncated: false });
    renderDetail("sys-Kontroll");

    await userEvent.click(await screen.findByRole("button", { name: systemsCopy.retry }));
    expect(await screen.findByRole("heading", { name: "Kontroll" })).toBeTruthy();
    expect(fetchTeamSystemsMock).toHaveBeenCalledTimes(2);
  });

  it("offers the edit action only when the server says the caller can edit", async () => {
    fetchTeamSystemsMock.mockResolvedValue({ status: "ok", systems: [system({ name: "Kontroll" })], canEdit: false, truncated: false });
    renderDetail("sys-Kontroll");

    await screen.findByRole("heading", { name: "Kontroll" });
    expect(screen.queryByRole("button", { name: "Rediger: Kontroll" })).toBeNull();
  });

  it("opens the shared editor for an authorized editor", async () => {
    fetchTeamSystemsMock.mockResolvedValue({ status: "ok", systems: [system({ name: "Kontroll" })], canEdit: true, truncated: false });
    renderDetail("sys-Kontroll");

    await userEvent.click(await screen.findByRole("button", { name: "Rediger: Kontroll" }));
    expect(await screen.findByRole("heading", { name: systemsCopy.form.editTitle })).toBeTruthy();
  });
});

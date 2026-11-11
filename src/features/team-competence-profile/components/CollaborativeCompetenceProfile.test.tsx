// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const hook = vi.hoisted(() => ({ state: null as unknown }));
const reload = vi.hoisted(() => vi.fn());
const saveLevel = vi.hoisted(() => vi.fn());
const radarAxes = vi.hoisted(() => vi.fn());

vi.mock("../client/use-collaborative-team-data", () => ({
  useCollaborativeTeamData: () => hook.state,
}));
vi.mock("../../team-competence-plan/client/use-competence-plans", () => ({
  useCompetencePlans: () => ({ data: { phase: "loading" } }),
}));
vi.mock("../client/collaborative-gateway", () => ({
  saveCollaborativeLevel: saveLevel,
  saveCollaborativeMode: vi.fn(),
  setTeamAreaStatus: vi.fn(),
  assignTeamArea: vi.fn(),
}));
vi.mock("../../team-skills/client/team-skills-gateway", () => ({
  fetchSkillNeeds: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock("./KompetanseprofilRadar", () => ({
  KompetanseprofilRadar: ({ axes }: { axes: unknown }) => {
    radarAxes(axes);
    return <div data-testid="radar" />;
  },
}));
vi.mock("./TeamCompetenceProfile", () => ({
  useAutomaticTeamProfile: () => ({ current: null, retry: () => undefined }),
  availableAutomaticRows: () => null,
  AutomaticProfileView: () => <div data-testid="automatic-profile" />,
}));

const { CollaborativeCompetenceProfile } = await import("./CollaborativeCompetenceProfile");

const AREAS = [
  { treeId: "t-a", name: "Testing", status: "active", sortOrder: 0 },
  { treeId: "t-b", name: "Deploy", status: "archived", sortOrder: 1 },
];

function loaded(options: { canEdit: boolean; mode: "automatic" | "collaborative"; levels?: { treeId: string; level: 1 | 2 | 3 | 4 }[] }) {
  return {
    phase: "signed_in",
    token: "tok",
    reload,
    current: {
      key: "k1",
      profile: { status: "ok", mode: options.mode, levels: options.levels ?? [] },
      areas: { status: "ok", areas: AREAS, canEdit: options.canEdit, truncated: false },
    },
  };
}

beforeEach(() => {
  reload.mockClear();
  saveLevel.mockReset();
  radarAxes.mockClear();
});

afterEach(cleanup);

describe("CollaborativeCompetenceProfile", () => {
  it("shows the automatic panel, not the collaborative radar, when the stored mode is automatic", () => {
    hook.state = loaded({ canEdit: true, mode: "automatic" });
    render(<CollaborativeCompetenceProfile teamId="team-1" />);
    expect(screen.getByTestId("automatic-profile")).toBeTruthy();
    expect(screen.queryByTestId("radar")).toBeNull();
  });

  it("draws the radar from the active areas only, with the teamadmin-entered level", () => {
    hook.state = loaded({ canEdit: false, mode: "collaborative", levels: [{ treeId: "t-a", level: 3 }] });
    render(<CollaborativeCompetenceProfile teamId="team-1" />);
    const axes = radarAxes.mock.calls.at(-1)?.[0] as { treeId: string; teamLevel: number | null }[];
    expect(axes.map((axis) => axis.treeId)).toEqual(["t-a"]);
    expect(axes[0]?.teamLevel).toBe(3);
  });

  it("gives a member the radar only, with no level editor or area management", () => {
    hook.state = loaded({ canEdit: false, mode: "collaborative" });
    render(<CollaborativeCompetenceProfile teamId="team-1" />);
    expect(screen.getByTestId("radar")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Felles nivå per område" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Tildelte kompetanseområder" })).toBeNull();
  });

  it("gives a teamadmin the level editor, and saves a chosen level", async () => {
    hook.state = loaded({ canEdit: true, mode: "collaborative" });
    saveLevel.mockResolvedValue({ status: "ok" });
    render(<CollaborativeCompetenceProfile teamId="team-1" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Felles nivå for Testing" }), { target: { value: "2" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Lagre nivå" })[0]!);

    await waitFor(() => expect(saveLevel).toHaveBeenCalledWith("tok", "team-1", "t-a", 2));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("clears a team level when the teamadmin selects 'Ikke satt'", async () => {
    hook.state = loaded({ canEdit: true, mode: "collaborative", levels: [{ treeId: "t-a", level: 4 }] });
    saveLevel.mockResolvedValue({ status: "ok" });
    render(<CollaborativeCompetenceProfile teamId="team-1" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Felles nivå for Testing" }), { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Lagre nivå" })[0]!);

    await waitFor(() => expect(saveLevel).toHaveBeenCalledWith("tok", "team-1", "t-a", null));
  });

  it("states that the team has no level yet, instead of drawing zero", () => {
    hook.state = loaded({ canEdit: false, mode: "collaborative" });
    render(<CollaborativeCompetenceProfile teamId="team-1" />);
    expect(screen.getByText("Sett felles nivå for minst ett aktivt område for å se radaren.")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RadarAxisInput } from "../domain/radar-model";

const fetchTeamSkills = vi.fn();
const fetchTeamSkillAggregate = vi.fn();
const fetchTeamManualAssessments = vi.fn();
const setTeamManualAssessment = vi.fn();
const clearTeamManualAssessment = vi.fn();

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const { useEffect } = await import("react");
  return {
    useAuthGatedResource: (callback: (token: string | null) => void, deps: readonly unknown[]) => {
      useEffect(() => {
        callback("test-token");
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps);
    },
  };
});

vi.mock("../client/team-skills-gateway", () => ({
  fetchTeamSkills: (...args: unknown[]) => fetchTeamSkills(...args),
  fetchTeamSkillAggregate: (...args: unknown[]) => fetchTeamSkillAggregate(...args),
  fetchTeamManualAssessments: (...args: unknown[]) => fetchTeamManualAssessments(...args),
  setTeamManualAssessment: (...args: unknown[]) => setTeamManualAssessment(...args),
  clearTeamManualAssessment: (...args: unknown[]) => clearTeamManualAssessment(...args),
}));

vi.mock("./KompetanseprofilRadar", () => ({
  KompetanseprofilRadar: ({ axes }: { axes: readonly RadarAxisInput[] }) => (
    <div data-testid="radar" data-axes={JSON.stringify(axes.map((axis) => [axis.label, axis.teamLevel]))} />
  ),
}));

vi.mock("./TeamSkillsAdmin", () => ({
  TeamSkillsAdmin: () => <div data-testid="skills-admin" />,
}));

const { TeamCompetenceWorkspace } = await import("./TeamCompetenceWorkspace");

const TEAM = "team-1";

/** Synthetic catalog: three active skills and one inactive skill that must never appear. */
const SKILLS = [
  { skillId: "sk1", name: "Testing", description: "", category: null, guidance: {}, criteriaVersion: 1, active: true, sortOrder: 0 },
  { skillId: "sk2", name: "Kubernetes", description: "", category: null, guidance: {}, criteriaVersion: 1, active: true, sortOrder: 1 },
  { skillId: "sk3", name: "Terraform", description: "", category: null, guidance: {}, criteriaVersion: 1, active: true, sortOrder: 2 },
  { skillId: "sk9", name: "Utgått", description: "", category: null, guidance: {}, criteriaVersion: 1, active: false, sortOrder: 3 },
];

function catalog(canEdit: boolean) {
  return { status: "ok", skills: SKILLS, canEdit, own: [], truncated: false };
}

/** Automatic: sk1 has a value, sk2 is suppressed (insufficient), sk3 has a value. */
const AUTOMATIC = {
  status: "ok",
  availability: "available",
  rows: [
    { skillId: "sk1", name: "Testing", state: "value", level: 3 },
    { skillId: "sk2", name: "Kubernetes", state: "insufficient_data" },
    { skillId: "sk3", name: "Terraform", state: "value", level: 2 },
  ],
};

/** Collaborative: only sk1 is agreed (with a note); sk2 and sk3 are not assessed. */
const MANUAL = {
  status: "ok",
  canEdit: true,
  assessments: [
    { skillId: "sk1", name: "Testing", level: 4, note: "Enighet på workshop", criteriaVersion: 1, outdated: false, updatedAt: "2026-06-01T00:00:00.000Z" },
  ],
};

beforeEach(() => {
  fetchTeamSkills.mockResolvedValue(catalog(false));
  fetchTeamSkillAggregate.mockResolvedValue(AUTOMATIC);
  fetchTeamManualAssessments.mockResolvedValue({ ...MANUAL, canEdit: false });
  setTeamManualAssessment.mockResolvedValue({ status: "ok" });
  clearTeamManualAssessment.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function radarAxes(): Array<[string, number | null]> {
  return JSON.parse(screen.getByTestId("radar").getAttribute("data-axes") ?? "[]") as Array<[string, number | null]>;
}

describe("TeamCompetenceWorkspace — one page, two modes", () => {
  it("opens on the automatic profile and labels the active mode", async () => {
    render(<TeamCompetenceWorkspace teamId={TEAM} />);

    const automatic = await screen.findByRole("button", { name: "Automatisk profil" });
    expect(automatic.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Felles vurdering" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Viser: Automatisk profil")).toBeTruthy();
    expect(screen.getByText(/minst 3 medlemmer/)).toBeTruthy();
  });

  it("never plots a suppressed skill as zero and lists it as not enough data", async () => {
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    const table = await screen.findByRole("table");

    expect(radarAxes()).toEqual([
      ["Testing", 3],
      ["Terraform", 2],
    ]);
    expect(within(table).getByRole("rowheader", { name: "Kubernetes" })).toBeTruthy();
    expect(within(table).getByText("Ikke nok data ennå")).toBeTruthy();
  });

  it("omits inactive skills from both the radar and the list", async () => {
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    const table = await screen.findByRole("table");

    expect(within(table).queryByText("Utgått")).toBeNull();
    expect(radarAxes().some(([label]) => label === "Utgått")).toBe(false);
  });

  it("switches to the collaborative profile, which uses the same skills and shows agreed levels with notes", async () => {
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));

    expect(screen.getByText("Viser: Felles vurdering")).toBeTruthy();
    expect(screen.getByText(/ikke en sammenstilling av individuelle vurderinger/)).toBeTruthy();
    expect(radarAxes()).toEqual([["Testing", 4]]);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Nivå 4: Avansert")).toBeTruthy();
    expect(within(table).getByText("Enighet på workshop")).toBeTruthy();
    expect(within(table).getAllByText("Ikke vurdert")).toHaveLength(2);
  });

  it("does not show the level editor or the catalog administration to ordinary members", async () => {
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));

    expect(screen.queryByRole("button", { name: "Lagre" })).toBeNull();
    expect(screen.queryByTestId("skills-admin")).toBeNull();
  });

  it("gives a team administrator the level editor in the collaborative mode and the catalog administration", async () => {
    fetchTeamSkills.mockResolvedValue(catalog(true));
    fetchTeamManualAssessments.mockResolvedValue(MANUAL);
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await screen.findByRole("table");

    expect(screen.getByTestId("skills-admin")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));

    expect(screen.getAllByRole("button", { name: "Lagre" })).toHaveLength(3);
  });

  it("saves an agreed level for one skill with its trimmed note and reloads the profile", async () => {
    fetchTeamSkills.mockResolvedValue(catalog(true));
    fetchTeamManualAssessments.mockResolvedValue(MANUAL);
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));

    const kubernetesForm = screen.getByRole("form", { name: "Kubernetes" });
    await user.selectOptions(within(kubernetesForm).getByLabelText("Avtalt nivå"), "2");
    await user.type(within(kubernetesForm).getByLabelText(/Merknad/), "  Vi enes om dette  ");
    await user.click(within(kubernetesForm).getByRole("button", { name: "Lagre" }));

    expect(setTeamManualAssessment).toHaveBeenCalledWith("test-token", TEAM, "sk2", 2, "Vi enes om dette");
    expect(await within(kubernetesForm).findByText("Lagret.")).toBeTruthy();
    expect(fetchTeamManualAssessments.mock.calls.length).toBeGreaterThan(1);
  });

  it("clears the agreed level when the editor is set to not assessed", async () => {
    fetchTeamSkills.mockResolvedValue(catalog(true));
    fetchTeamManualAssessments.mockResolvedValue(MANUAL);
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));

    const testingForm = screen.getByRole("form", { name: "Testing" });
    await user.selectOptions(within(testingForm).getByLabelText("Avtalt nivå"), "");
    await user.click(within(testingForm).getByRole("button", { name: "Lagre" }));

    expect(clearTeamManualAssessment).toHaveBeenCalledWith("test-token", TEAM, "sk1");
    expect(setTeamManualAssessment).not.toHaveBeenCalled();
  });

  it("shows a read failure honestly instead of an empty or zero profile", async () => {
    fetchTeamSkillAggregate.mockResolvedValue({ status: "read_failed" });
    render(<TeamCompetenceWorkspace teamId={TEAM} />);

    expect(await screen.findByText("Teamkompetansen kan ikke lastes akkurat nå.")).toBeTruthy();
    expect(screen.queryByTestId("radar")).toBeNull();
  });

  it("shows a forbidden catalog as an access message, never a profile", async () => {
    fetchTeamSkills.mockResolvedValue({ status: "forbidden" });
    render(<TeamCompetenceWorkspace teamId={TEAM} />);

    expect(await screen.findByText("Du har ikke tilgang til teamkompetansen.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

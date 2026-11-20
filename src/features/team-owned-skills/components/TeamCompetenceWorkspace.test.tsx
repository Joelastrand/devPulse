// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RadarAxisInput } from "../domain/radar-model";

/** The page has loaded once the mode switch is rendered (it is not part of the loading skeleton). */
async function waitForLoaded() {
  return screen.findByRole("group", { name: "Visningsmodus" });
}

/**
 * The complete level table. It lives in the Tabell view of the level section, so the view is switched first. The table is
 * read inside that section, because the radar has its own table.
 */
function openLevelTable(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Tabell" }));
  return within(screen.getByRole("region", { name: "Nivå per område" })).getByRole("table");
}

async function loadedLevelTable(): Promise<HTMLElement> {
  await waitForLoaded();
  return openLevelTable();
}

/** Waits until the page shows the named skill as a row of the complete level table. */
async function loadedWithSkill(name: string): Promise<HTMLElement> {
  await waitForLoaded();
  return within(openLevelTable()).getByRole("rowheader", { name });
}

const fetchTeamSkills = vi.fn();
const fetchTeamSkillAggregate = vi.fn();
const fetchTeamManualAssessments = vi.fn();
const setTeamManualAssessment = vi.fn();
const clearTeamManualAssessment = vi.fn();

/**
 * The real `useAuthGatedResource` runs against a controllable identity stream, so the generation guard under test is the
 * production one. `emitAuth` simulates sign-in, sign-out and account switches from outside the component.
 */
const authStream = vi.hoisted(() => ({
  token: "test-token" as string | null,
  listeners: new Set<(token: string | null) => void>(),
}));

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: (callback: (token: string | null) => void) => {
    authStream.listeners.add(callback);
    callback(authStream.token);
    return () => {
      authStream.listeners.delete(callback);
    };
  },
}));

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

vi.mock("./TeamLevelBarChart", () => ({
  TeamLevelBarChart: ({ rows }: { rows: readonly unknown[] }) => <div data-testid="bar-chart" data-rows={JSON.stringify(rows)} />,
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
  authStream.token = "test-token";
  authStream.listeners.clear();
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

// View preferences persist in localStorage. Clearing it keeps each test's starting view (chart, levels open) independent.
beforeEach(() => {
  window.localStorage.clear();
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
    const table = await loadedLevelTable();

    expect(radarAxes()).toEqual([
      ["Testing", 3],
      ["Terraform", 2],
    ]);
    expect(within(table).getByRole("rowheader", { name: "Kubernetes" })).toBeTruthy();
    expect(within(table).getByText("Ikke nok data ennå")).toBeTruthy();
  });

  it("omits inactive skills from both the radar and the list", async () => {
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    const table = await loadedLevelTable();

    expect(within(table).queryByText("Utgått")).toBeNull();
    expect(radarAxes().some(([label]) => label === "Utgått")).toBe(false);
  });

  it("switches to the collaborative profile, which uses the same skills and shows agreed levels with notes", async () => {
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));

    expect(screen.getByText("Viser: Felles vurdering")).toBeTruthy();
    expect(screen.getByText(/ikke en sammenstilling av individuelle vurderinger/)).toBeTruthy();
    expect(radarAxes()).toEqual([["Testing", 4]]);
    const table = openLevelTable();
    expect(within(table).getByText("Nivå 4: Avansert")).toBeTruthy();
    expect(within(table).getByText("Enighet på workshop")).toBeTruthy();
    expect(within(table).getAllByText("Ikke vurdert")).toHaveLength(2);
  });

  it("does not show the level editor or the catalog administration to ordinary members", async () => {
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));

    expect(screen.queryByRole("button", { name: "Lagre" })).toBeNull();
    expect(screen.queryByTestId("skills-admin")).toBeNull();
  });

  it("gives a team administrator the level editor in the collaborative mode and the catalog administration", async () => {
    fetchTeamSkills.mockResolvedValue(catalog(true));
    fetchTeamManualAssessments.mockResolvedValue(MANUAL);
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    expect(screen.getByTestId("skills-admin")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));

    expect(screen.getAllByRole("button", { name: "Lagre" })).toHaveLength(3);
  });

  it("saves an agreed level for one skill with its trimmed note and reloads the profile", async () => {
    fetchTeamSkills.mockResolvedValue(catalog(true));
    fetchTeamManualAssessments.mockResolvedValue(MANUAL);
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));

    const kubernetesForm = screen.getByRole("form", { name: "Kubernetes" });
    await user.selectOptions(within(kubernetesForm).getByLabelText("Avtalt nivå"), "2");
    await user.type(within(kubernetesForm).getByLabelText(/Merknad/), "  Vi enes om dette  ");
    await user.click(within(kubernetesForm).getByRole("button", { name: "Lagre" }));

    expect(setTeamManualAssessment).toHaveBeenCalledWith("test-token", TEAM, "sk2", 2, "Vi enes om dette");
    expect(await screen.findByText("Lagret.")).toBeTruthy();
    expect(fetchTeamManualAssessments.mock.calls.length).toBeGreaterThan(1);
  });

  it("clears the agreed level when the editor is set to not assessed", async () => {
    fetchTeamSkills.mockResolvedValue(catalog(true));
    fetchTeamManualAssessments.mockResolvedValue(MANUAL);
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();
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

describe("TeamCompetenceWorkspace — simulated demo data notice", () => {
  const NOTICE = /simulerte demodata for fiktive teammedlemmer/;

  it("shows the Norwegian simulated-data notice when the aggregate includes simulated contributors", async () => {
    fetchTeamSkillAggregate.mockResolvedValue({ ...AUTOMATIC, includesSimulated: true });
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.getByText(/ikke ekte samtykke fra ansatte/)).toBeTruthy();
  });

  it("does not show the notice when the aggregate contains only genuine contributors", async () => {
    fetchTeamSkillAggregate.mockResolvedValue({ ...AUTOMATIC, includesSimulated: false });
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});

/** Synthetic catalog of ten active areas. Area 10 is suppressed in the automatic profile. */
const MANY_SKILLS = Array.from({ length: 10 }, (_, index) => ({
  skillId: `m${index + 1}`,
  name: `Område ${String(index + 1).padStart(2, "0")}`,
  description: "",
  category: null,
  guidance: {},
  criteriaVersion: 1,
  active: true,
  sortOrder: index,
}));

const MANY_AUTOMATIC = {
  status: "ok",
  availability: "available",
  includesSimulated: false,
  rows: MANY_SKILLS.map((skill, index) =>
    index === 9
      ? { skillId: skill.skillId, name: skill.name, state: "insufficient_data" }
      : { skillId: skill.skillId, name: skill.name, state: "value", level: (index % 4) + 1 },
  ),
};

function barRows(): Array<{ skillId: string; name: string; level: number }> {
  return JSON.parse(screen.getByTestId("bar-chart").getAttribute("data-rows") ?? "[]") as Array<{ skillId: string; name: string; level: number }>;
}

/** The area selector is a collapsed section by default. Opens it (only if closed) and returns its option group. */
function openAreaSelector(): HTMLElement {
  const toggle = screen.getByRole("button", { name: "Velg kompetanseområder" });
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  return screen.getByRole("group", { name: "Velg områder i radaren" });
}

describe("TeamCompetenceWorkspace — more than eight eligible areas", () => {
  beforeEach(() => {
    fetchTeamSkills.mockResolvedValue({ status: "ok", skills: MANY_SKILLS, canEdit: false, own: [], truncated: false });
    fetchTeamSkillAggregate.mockResolvedValue(MANY_AUTOMATIC);
  });

  it("draws the radar with the first eight eligible areas by default and lists all nine eligible areas as choices", async () => {
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    const labels = radarAxes().map(([label]) => label);
    expect(labels).toEqual(["Område 01", "Område 02", "Område 03", "Område 04", "Område 05", "Område 06", "Område 07", "Område 08"]);
    expect(within(openAreaSelector()).getAllByRole("checkbox")).toHaveLength(9);
  });

  it("gives the bar chart the eight selected areas by default, and every eligible area after 'Vis alle områder'", async () => {
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    expect(barRows().map((row) => row.name)).toEqual([
      "Område 01",
      "Område 02",
      "Område 03",
      "Område 04",
      "Område 05",
      "Område 06",
      "Område 07",
      "Område 08",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Vis alle områder (9)" }));
    expect(barRows().map((row) => row.name)).toHaveLength(9);
    expect(barRows().find((row) => row.name === "Område 01")?.level).toBe(1);
    expect(barRows().some((row) => row.name === "Område 10")).toBe(false);
  });

  it("keeps the suppressed area out of the radar and shows it as not enough data in the complete table", async () => {
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    const table = await loadedLevelTable();

    expect(radarAxes().some(([label]) => label === "Område 10")).toBe(false);
    expect(within(table).getByRole("rowheader", { name: "Område 10" })).toBeTruthy();
    expect(within(table).getByText("Ikke nok data ennå")).toBeTruthy();
    expect(within(table).getAllByRole("rowheader")).toHaveLength(10);
  });

  it("changes the radar and the default bar chart with the selection, while the table keeps every area", async () => {
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    await user.click(within(openAreaSelector()).getByRole("checkbox", { name: "Område 01" }));
    expect(radarAxes().map(([label]) => label)).not.toContain("Område 01");
    expect(radarAxes()).toHaveLength(7);
    expect(barRows().map((row) => row.name)).not.toContain("Område 01");

    await user.click(within(openAreaSelector()).getByRole("checkbox", { name: "Område 09" }));
    expect(radarAxes().map(([label]) => label)).toContain("Område 09");
    expect(radarAxes()).toHaveLength(8);
    expect(barRows().map((row) => row.name)).toContain("Område 09");

    const table = openLevelTable();
    expect(within(table).getAllByRole("rowheader")).toHaveLength(10);
  });

  it("disables the unchecked choices once the radar is full, and enables them again after one is removed", async () => {
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    expect(within(openAreaSelector()).getByRole("checkbox", { name: "Område 09" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Radaren viser åtte områder. Fjern ett område for å velge et annet.")).toBeTruthy();

    await user.click(within(openAreaSelector()).getByRole("checkbox", { name: "Område 08" }));
    expect(within(openAreaSelector()).getByRole("checkbox", { name: "Område 09" }).hasAttribute("disabled")).toBe(false);
  });

  it("shows the simulated-data notice above the profile when the aggregate includes simulated contributors", async () => {
    fetchTeamSkillAggregate.mockResolvedValue({ ...MANY_AUTOMATIC, includesSimulated: true });
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    expect(screen.getByText(/simulerte demodata for fiktive teammedlemmer/)).toBeTruthy();
    expect(radarAxes()).toHaveLength(8);
  });

  it("applies the same selection in the collaborative mode, which uses the agreed levels", async () => {
    fetchTeamManualAssessments.mockResolvedValue({
      status: "ok",
      canEdit: false,
      assessments: MANY_SKILLS.slice(0, 9).map((skill, index) => ({
        skillId: skill.skillId,
        name: skill.name,
        level: (index % 4) + 1,
        note: null,
        criteriaVersion: 1,
        outdated: false,
        updatedAt: "2026-06-01T00:00:00.000Z",
      })),
    });
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));

    expect(radarAxes()).toHaveLength(8);
    expect(barRows()).toHaveLength(8);
    expect(within(openAreaSelector()).getAllByRole("checkbox")).toHaveLength(9);
  });
});

describe("TeamCompetenceWorkspace — collapsible radar selector and full table", () => {
  beforeEach(() => {
    fetchTeamSkills.mockResolvedValue({ status: "ok", skills: MANY_SKILLS, canEdit: false, own: [], truncated: false });
    fetchTeamSkillAggregate.mockResolvedValue(MANY_AUTOMATIC);
  });

  it("starts with the area selector collapsed, shows the count, and keeps the radar visible", async () => {
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    expect(screen.getByRole("button", { name: "Velg kompetanseområder" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Velg kompetanseområder")).toBeTruthy();
    // The count is shown in the collapsed summary; the same count also sits in the mounted, hidden panel.
    expect(within(screen.getByRole("button", { name: "Velg kompetanseområder" })).getByText("8 av 9 områder valgt")).toBeTruthy();
    expect(radarAxes()).toHaveLength(8);
  });

  it("expands the selector and keeps the selection behaviour: deselect one area, select another", async () => {
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    await user.click(screen.getByText("Velg kompetanseområder"));
    expect(screen.getByRole("button", { name: "Velg kompetanseområder" }).getAttribute("aria-expanded")).toBe("true");

    await user.click(within(openAreaSelector()).getByRole("checkbox", { name: "Område 01" }));
    expect(radarAxes().map(([label]) => label)).not.toContain("Område 01");
    expect(screen.getByText("7 av 9 områder valgt")).toBeTruthy();

    await user.click(within(openAreaSelector()).getByRole("checkbox", { name: "Område 09" }));
    expect(radarAxes().map(([label]) => label)).toContain("Område 09");
    expect(radarAxes()).toHaveLength(8);
  });

  it("disables unselected areas and shows the limit message when eight areas are selected", async () => {
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();
    await user.click(screen.getByText("Velg kompetanseområder"));

    expect(within(openAreaSelector()).getByRole("checkbox", { name: "Område 09" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Radaren viser åtte områder. Fjern ett område for å velge et annet.")).toBeTruthy();
  });

  it("restores the default eight areas with 'Tilbakestill utvalg'", async () => {
    const user = userEvent.setup();
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();
    await user.click(screen.getByText("Velg kompetanseområder"));

    await user.click(within(openAreaSelector()).getByRole("checkbox", { name: "Område 01" }));
    await user.click(within(openAreaSelector()).getByRole("checkbox", { name: "Område 09" }));
    await user.click(screen.getByRole("button", { name: "Tilbakestill utvalg" }));

    expect(radarAxes().map(([label]) => label)).toEqual([
      "Område 01",
      "Område 02",
      "Område 03",
      "Område 04",
      "Område 05",
      "Område 06",
      "Område 07",
      "Område 08",
    ]);
    expect(screen.getByText("8 av 9 områder valgt")).toBeTruthy();
  });

  it("shows the complete table in the Tabell view, including the suppressed area as not enough data", async () => {
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();

    const table = openLevelTable();
    expect(within(table).getByText("Ikke nok data ennå")).toBeTruthy();
    expect(within(table).getByText("Område 10")).toBeTruthy();
    expect(screen.queryByTestId("bar-chart")).toBeNull();
  });
});

/** A request whose resolution the test controls, so a response can arrive after the auth state has moved on. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Synthetic catalog for a different account or team: one active skill whose name identifies it. */
function foreignCatalog(name: string) {
  return {
    status: "ok",
    skills: [{ skillId: "skX", name, description: "", category: null, guidance: {}, criteriaVersion: 1, active: true, sortOrder: 0 }],
    canEdit: false,
    own: [],
    truncated: false,
  };
}

function emitAuth(token: string | null) {
  authStream.token = token;
  for (const listener of [...authStream.listeners]) listener(token);
}

/** Lets pending promise callbacks run and React apply their state updates. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("TeamCompetenceWorkspace — stale responses cannot restore protected data", () => {
  const FOREIGN_NAME = "Ferdighet fra forrige konto";

  it("never shows account A's late response after the active account has switched to B", async () => {
    const pendingA = { catalog: deferred<unknown>(), automatic: deferred<unknown>(), manual: deferred<unknown>() };
    fetchTeamSkills.mockImplementation((token: string) => (token === "token-a" ? pendingA.catalog.promise : Promise.resolve(catalog(false))));
    fetchTeamSkillAggregate.mockImplementation((token: string) => (token === "token-a" ? pendingA.automatic.promise : Promise.resolve(AUTOMATIC)));
    fetchTeamManualAssessments.mockImplementation((token: string) => (token === "token-a" ? pendingA.manual.promise : Promise.resolve({ ...MANUAL, canEdit: false })));

    authStream.token = "token-a";
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    emitAuth("token-b");
    expect(await loadedWithSkill("Testing")).toBeTruthy();

    pendingA.catalog.resolve(foreignCatalog(FOREIGN_NAME));
    pendingA.automatic.resolve({ status: "ok", availability: "available", rows: [{ skillId: "skX", name: FOREIGN_NAME, state: "value", level: 5 }] });
    pendingA.manual.resolve({ status: "ok", canEdit: false, assessments: [] });
    await flush();

    expect(screen.queryByText(FOREIGN_NAME)).toBeNull();
    const table = openLevelTable();
    expect(within(table).queryByText(FOREIGN_NAME)).toBeNull();
    expect(within(table).getByRole("rowheader", { name: "Testing" })).toBeTruthy();
  });

  it("never shows a late response after sign-out, and shows the sign-out message instead", async () => {
    const pending = deferred<unknown>();
    fetchTeamSkills.mockImplementation((token: string) => (token === "token-a" ? pending.promise : Promise.resolve(catalog(false))));

    authStream.token = "token-a";
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    emitAuth(null);
    expect(await screen.findByText("Logg inn for å se teamkompetansen.")).toBeTruthy();

    pending.resolve(foreignCatalog(FOREIGN_NAME));
    await flush();

    expect(screen.queryByText(FOREIGN_NAME)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("never shows a late response from the previous team after the page moves to another team", async () => {
    const pendingTeamOne = deferred<unknown>();
    fetchTeamSkills.mockImplementation((_token: string, teamId: string) =>
      teamId === "team-1" ? pendingTeamOne.promise : Promise.resolve(catalog(false)),
    );

    authStream.token = "token-a";
    const { rerender } = render(<TeamCompetenceWorkspace teamId="team-1" />);
    rerender(<TeamCompetenceWorkspace teamId="team-2" />);
    expect(await loadedWithSkill("Testing")).toBeTruthy();

    pendingTeamOne.resolve(foreignCatalog(FOREIGN_NAME));
    await flush();

    expect(screen.queryByText(FOREIGN_NAME)).toBeNull();
    const table = openLevelTable();
    expect(within(table).queryByText(FOREIGN_NAME)).toBeNull();
    expect(within(table).getByRole("rowheader", { name: "Testing" })).toBeTruthy();
  });

  it("turns an unexpected rejected read into the read-failed message, not an indefinite skeleton", async () => {
    fetchTeamSkillAggregate.mockRejectedValue(new Error("network down"));
    render(<TeamCompetenceWorkspace teamId={TEAM} />);

    expect(await screen.findByText("Teamkompetansen kan ikke lastes akkurat nå.")).toBeTruthy();
    // The loading label of the skeleton is gone, so the failure is not presented as a pending read.
    expect(screen.queryByText("Laster kompetanser …")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("does not apply a rejection from a superseded account", async () => {
    const pendingA = deferred<unknown>();
    fetchTeamSkillAggregate.mockImplementation((token: string) => (token === "token-a" ? pendingA.promise : Promise.resolve(AUTOMATIC)));

    authStream.token = "token-a";
    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    emitAuth("token-b");
    expect(await loadedWithSkill("Testing")).toBeTruthy();

    pendingA.reject(new Error("late failure"));
    await flush();

    expect(screen.queryByText("Teamkompetansen kan ikke lastes akkurat nå.")).toBeNull();
    const table = openLevelTable();
    expect(within(table).queryByText(FOREIGN_NAME)).toBeNull();
    expect(within(table).getByRole("rowheader", { name: "Testing" })).toBeTruthy();
  });
});

describe("TeamCompetenceWorkspace — manual assessment saves", () => {
  async function openSkillForm(name: string) {
    fetchTeamSkills.mockResolvedValue(catalog(true));
    fetchTeamManualAssessments.mockResolvedValue(MANUAL);
    const user = userEvent.setup();
    const { rerender } = render(<TeamCompetenceWorkspace teamId={TEAM} />);
    await waitForLoaded();
    await user.click(screen.getByRole("button", { name: "Felles vurdering" }));
    const form = screen.getByRole("form", { name });
    return { user, form, rerender };
  }

  it("shows a pending label on the save button and blocks a second submit while the save is in flight", async () => {
    const pending = deferred<unknown>();
    setTeamManualAssessment.mockReturnValueOnce(pending.promise);
    const { user, form } = await openSkillForm("Kubernetes");
    await user.selectOptions(within(form).getByLabelText("Avtalt nivå"), "2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    const busy = within(form).getByRole("button", { name: "Lagrer …" });
    expect(busy.hasAttribute("disabled")).toBe(true);
    // A submit that bypasses the disabled button (Enter key) must not send a second write.
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(setTeamManualAssessment).toHaveBeenCalledTimes(1);

    pending.resolve({ status: "ok" });
    await flush();
  });

  it("confirms a successful save at page level and keeps the confirmation through the reload", async () => {
    const { user, form } = await openSkillForm("Kubernetes");
    await user.selectOptions(within(form).getByLabelText("Avtalt nivå"), "2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByText("Lagret.")).toBeTruthy();
    // The reload finishes and the page is loaded again; the confirmation is still there.
    await waitFor(() => expect(fetchTeamManualAssessments.mock.calls.length).toBeGreaterThan(1));
    expect(await waitForLoaded()).toBeTruthy();
    expect(screen.getByText("Lagret.")).toBeTruthy();
  });

  it("keeps the entered level and note after a failed save and offers the same button again", async () => {
    setTeamManualAssessment.mockResolvedValueOnce({ status: "persistence_failed" });
    const { user, form } = await openSkillForm("Kubernetes");
    await user.selectOptions(within(form).getByLabelText("Avtalt nivå"), "3");
    await user.type(within(form).getByLabelText(/Merknad/), "Behold denne");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await within(form).findByText("Kunne ikke lagre. Prøv igjen.")).toBeTruthy();
    expect((within(form).getByLabelText("Avtalt nivå") as HTMLSelectElement).value).toBe("3");
    expect((within(form).getByLabelText(/Merknad/) as HTMLTextAreaElement).value).toBe("Behold denne");
    expect(within(form).getByRole("button", { name: "Lagre" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("Lagret.")).toBeNull();
  });

  it("shows an access message, not a generic save failure, when the write is refused as forbidden", async () => {
    setTeamManualAssessment.mockResolvedValueOnce({ status: "forbidden" });
    const { user, form } = await openSkillForm("Kubernetes");
    await user.selectOptions(within(form).getByLabelText("Avtalt nivå"), "2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await within(form).findByText("Du har ikke tilgang til å endre teamkompetansen.")).toBeTruthy();
    expect(screen.queryByText("Kunne ikke lagre. Prøv igjen.")).toBeNull();
    expect(screen.queryByText("Lagret.")).toBeNull();
  });

  it("never confirms a save after sign-out during the write, even when the write later succeeds", async () => {
    const pending = deferred<unknown>();
    setTeamManualAssessment.mockReturnValueOnce(pending.promise);
    const { user, form } = await openSkillForm("Kubernetes");
    await user.selectOptions(within(form).getByLabelText("Avtalt nivå"), "2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    emitAuth(null);
    expect(await screen.findByText("Logg inn for å se teamkompetansen.")).toBeTruthy();
    pending.resolve({ status: "ok" });
    await flush();

    expect(screen.queryByText("Lagret.")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("never confirms a save from the previous account after the active account has switched", async () => {
    const pending = deferred<unknown>();
    setTeamManualAssessment.mockReturnValueOnce(pending.promise);
    const { user, form } = await openSkillForm("Kubernetes");
    await user.selectOptions(within(form).getByLabelText("Avtalt nivå"), "2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    emitAuth("token-b");
    expect(await waitForLoaded()).toBeTruthy();
    pending.resolve({ status: "ok" });
    await flush();

    expect(screen.queryByText("Lagret.")).toBeNull();
  });

  it("never shows a late failure from a superseded team after the page has moved to another team", async () => {
    const pending = deferred<unknown>();
    setTeamManualAssessment.mockReturnValueOnce(pending.promise);
    const { user, form, rerender } = await openSkillForm("Kubernetes");
    await user.selectOptions(within(form).getByLabelText("Avtalt nivå"), "2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    rerender(<TeamCompetenceWorkspace teamId="team-2" />);
    await waitForLoaded();
    pending.resolve({ status: "persistence_failed" });
    await flush();

    expect(screen.queryByText("Kunne ikke lagre. Prøv igjen.")).toBeNull();
    expect(screen.queryByText("Lagret.")).toBeNull();
  });
});

describe("TeamCompetenceWorkspace — loaded protected data is cleared before the next read completes", () => {
  const LOADED_NAME = "Ferdighet som var lastet";

  it("clears account A's loaded profile during a direct switch to account B, while B's read is pending", async () => {
    authStream.token = "token-a";
    fetchTeamSkills.mockImplementation((token: string) => (token === "token-a" ? Promise.resolve(foreignCatalog(LOADED_NAME)) : new Promise(() => {})));

    render(<TeamCompetenceWorkspace teamId={TEAM} />);
    expect(await loadedWithSkill(LOADED_NAME)).toBeTruthy();

    act(() => emitAuth("token-b"));

    expect(screen.queryByText(LOADED_NAME)).toBeNull();
    expect(screen.queryByTestId("radar")).toBeNull();
  });

  it("clears the previous team's loaded profile when the page moves to another team, while the new team's read is pending", async () => {
    authStream.token = "token-a";
    fetchTeamSkills.mockImplementation((_token: string, teamId: string) => (teamId === "team-1" ? Promise.resolve(foreignCatalog(LOADED_NAME)) : new Promise(() => {})));

    const { rerender } = render(<TeamCompetenceWorkspace teamId="team-1" />);
    expect(await loadedWithSkill(LOADED_NAME)).toBeTruthy();

    rerender(<TeamCompetenceWorkspace teamId="team-2" />);

    expect(screen.queryByText(LOADED_NAME)).toBeNull();
    expect(screen.queryByTestId("radar")).toBeNull();
  });
});

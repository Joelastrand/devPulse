// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const fetchTeamProjects = vi.fn();
const fetchProjectParticipations = vi.fn();
const fetchAssignableMembers = vi.fn();
const writeTeamProject = vi.fn();
const writeProjectParticipation = vi.fn();

vi.mock("../client/team-projects-gateway", () => ({
  fetchTeamProjects: (...args: unknown[]) => fetchTeamProjects(...args),
  fetchProjectParticipations: (...args: unknown[]) => fetchProjectParticipations(...args),
  fetchAssignableMembers: (...args: unknown[]) => fetchAssignableMembers(...args),
  writeTeamProject: (...args: unknown[]) => writeTeamProject(...args),
  writeProjectParticipation: (...args: unknown[]) => writeProjectParticipation(...args),
}));

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const React = await import("react");
  return {
    useAuthGatedResource: (callback: (token: string | null) => void) => {
      // The mock signs in once on mount; the real hook re-runs on token change, which this test never needs.
      React.useEffect(() => {
        callback("token-1");
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the mock signs in once on mount; the callback is not a dependency
      }, []);
    },
  };
});

vi.mock("../../teams/components/TeamPageHeader", () => ({
  TeamPageHeader: () => null,
}));

const { TeamProjectRoadmap } = await import("./TeamProjectRoadmap");

// Fixed "today": 2026-11-06 in the planning calendar, so the 6-month window is Nov 2026 – Apr 2027 (181 days).
const TODAY = new Date("2026-11-06T12:00:00Z");

const ACTIVE_DEMO = {
  projectId: "p-1",
  title: "Demo – Leveranse",
  startDate: "2026-11-01",
  endDate: "2026-12-31",
  lifecycleStatus: "planned",
  effectiveStatus: "active",
  priority: "high",
  archived: false,
};
const ACTIVE_OBSERVABILITY = {
  projectId: "p-2",
  title: "Observerbarhet",
  startDate: "2026-12-15",
  endDate: "2027-02-28",
  lifecycleStatus: "planned",
  effectiveStatus: "planned",
  priority: "medium",
  archived: false,
};
const ARCHIVED_OLD = {
  projectId: "p-3",
  title: "Gammelt prosjekt",
  startDate: "2026-01-01",
  endDate: "2026-03-01",
  lifecycleStatus: "completed",
  effectiveStatus: "completed",
  priority: "low",
  archived: true,
};

const PARTICIPATION_ANNA = {
  participationId: "a-1",
  projectId: "p-1",
  memberRef: "m-1",
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  note: null,
  archived: false,
  overlapsOther: false,
};
const PARTICIPATION_UNNAMED = {
  participationId: "a-2",
  projectId: "p-2",
  memberRef: "m-2",
  startDate: "2026-12-01",
  endDate: "2026-12-20",
  note: null,
  archived: false,
  overlapsOther: true,
};

/** A 26-character member reference in the format the domain accepts. Fixtures with shorter ids are not valid members. */
const VALID_MEMBER_REF = "0123456789abcdefghjkmnpqrs";

function okProjects(canEdit: boolean, projects = [ACTIVE_DEMO, ACTIVE_OBSERVABILITY, ARCHIVED_OLD]) {
  return { status: "ok", projects, canEdit, truncated: false };
}

function okParticipations(participations: unknown[]) {
  return (_token: string, _teamId: string, projectId: string) => ({
    status: "ok",
    participations: participations.filter((item) => (item as { projectId: string }).projectId === projectId),
    truncated: false,
  });
}

/** The bar inside the desktop row for one project, found by its title (rows are grouped, so position is not stable). */
function barFor(title: string): HTMLElement {
  const row = screen.getAllByTestId("gantt-row").find((candidate) => within(candidate).queryByText(title) !== null);
  if (!row) throw new Error(`No Gantt row for ${title}`);
  return within(row).getByTestId("gantt-bar");
}

async function renderRoadmap() {
  render(<TeamProjectRoadmap teamId="team-1" />);
  await screen.findByRole("button", { name: "6 måneder" });
  await waitFor(() => expect(screen.queryByText("Laster prosjektplan …")).toBeNull());
}

describe("TeamProjectRoadmap", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
    fetchTeamProjects.mockResolvedValue(okProjects(false));
    fetchProjectParticipations.mockImplementation(okParticipations([PARTICIPATION_ANNA, PARTICIPATION_UNNAMED]));
    fetchAssignableMembers.mockResolvedValue({
      status: "ok",
      members: [{ memberRef: "m-1", displayName: "Anna Sørensen" }],
    });
    writeTeamProject.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows the loading state until the project read completes", () => {
    fetchTeamProjects.mockReturnValue(new Promise(() => undefined));
    render(<TeamProjectRoadmap teamId="team-1" />);

    expect(screen.getByText("Laster prosjektplan …")).toBeTruthy();
  });

  it("shows the empty state when the team has no active projects", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(false, [ARCHIVED_OLD]));
    await renderRoadmap();

    expect(screen.getByText("Ingen prosjekter er registrert ennå.")).toBeTruthy();
    expect(screen.queryAllByTestId("gantt-bar")).toHaveLength(0);
  });

  it("shows an error with retry when the project read fails", async () => {
    fetchTeamProjects.mockResolvedValueOnce({ status: "read_failed" });
    await renderRoadmap();

    expect(screen.getByRole("alert").textContent).toContain("Prosjektplanen kunne ikke lastes.");
    fetchTeamProjects.mockResolvedValueOnce(okProjects(false));
    fireEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    await waitFor(() => expect(screen.getAllByTestId("gantt-bar")).toHaveLength(2));
  });

  it("positions the six-month bars from the real dates", async () => {
    await renderRoadmap();
    // Demo – Leveranse: 1 Nov – 31 Dec = 61 of 181 days, starting at the window's first day.
    const demo = barFor("Demo – Leveranse");
    expect(parseFloat(demo.style.left)).toBeCloseTo(0);
    expect(parseFloat(demo.style.width)).toBeCloseTo((61 / 181) * 100);
    // Observerbarhet: 15 Dec – 28 Feb = 76 days, starting at day 44 (0-based).
    const observability = barFor("Observerbarhet");
    expect(parseFloat(observability.style.left)).toBeCloseTo((44 / 181) * 100);
    expect(parseFloat(observability.style.width)).toBeCloseTo((76 / 181) * 100);
  });

  it("switches to the three-month window and re-positions bars from the same dates", async () => {
    await renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "3 måneder" }));

    expect(screen.getByRole("button", { name: "3 måneder" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "6 måneder" }).getAttribute("aria-pressed")).toBe("false");
    // Window is Nov 2026 – Jan 2027 (92 days). Demo – Leveranse covers 61 days from the start.
    expect(parseFloat(barFor("Demo – Leveranse").style.width)).toBeCloseTo((61 / 92) * 100);
    // Observerbarhet is clipped at the window end: 15 Dec – 31 Jan = 48 days.
    expect(parseFloat(barFor("Observerbarhet").style.width)).toBeCloseTo((48 / 92) * 100);
  });

  it("shows the today marker with its date when today is inside the window", async () => {
    await renderRoadmap();

    expect(screen.getByText("I dag: 6. nov 2026")).toBeTruthy();
    expect(screen.queryByText("I dag er utenfor valgt periode: 6. nov 2026")).toBeNull();
  });

  it("collapses a status group to hide its rows and expands it again", async () => {
    await renderRoadmap();
    const plannedGroup = screen.getAllByRole("button", { name: /Planlagt.*1 prosjekt/ })[0];
    expect(plannedGroup.getAttribute("aria-expanded")).toBe("true");
    expect(barFor("Observerbarhet")).toBeTruthy();

    fireEvent.click(plannedGroup);
    expect(plannedGroup.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByTestId("gantt-bar")).toHaveLength(1);

    fireEvent.click(plannedGroup);
    expect(plannedGroup.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByTestId("gantt-bar")).toHaveLength(2);
  });

  it("labels each bar with its project, dates and clipping", async () => {
    await renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "3 måneder" }));

    const bar = barFor("Observerbarhet");
    expect(within(bar).getByText(/Observerbarhet: 15\. des 2026 til 28\. feb 2027, fortsetter etter valgt periode/)).toBeTruthy();
  });

  it("hides create, edit and archive controls from members (read-only)", async () => {
    await renderRoadmap();

    expect(screen.queryByRole("button", { name: "Nytt prosjekt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rediger: Demo – Leveranse" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Arkiver: Demo – Leveranse" })).toBeNull();
    expect(screen.getByText("Bare teamledere kan opprette og endre prosjekter.")).toBeTruthy();
  });

  it("shows create, edit and archive controls to a team lead", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    await renderRoadmap();

    expect(screen.getByRole("button", { name: "Nytt prosjekt" })).toBeTruthy();
    expect(leadButton("Rediger: Demo – Leveranse")).toBeTruthy();
    expect(leadButton("Arkiver: Demo – Leveranse")).toBeTruthy();
  });

  it("rejects an empty project title on the client before any write", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    await renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "Nytt prosjekt" }));
    fireEvent.click(screen.getByRole("button", { name: "Lagre prosjekt" }));

    expect(screen.getByText("Skriv inn et prosjektnavn.")).toBeTruthy();
    expect(writeTeamProject).not.toHaveBeenCalled();
  });

  it("creates a project through the lead write path and refreshes the plan", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    writeTeamProject.mockResolvedValue({ status: "ok", project: ACTIVE_DEMO });
    await renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "Nytt prosjekt" }));
    fireEvent.change(screen.getByLabelText("Prosjektnavn"), { target: { value: "Ny leveranse" } });
    fireEvent.change(screen.getByLabelText("Startdato"), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByLabelText("Sluttdato"), { target: { value: "2026-12-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Lagre prosjekt" }));

    await waitFor(() =>
      expect(writeTeamProject).toHaveBeenCalledWith("token-1", "team-1", "create", null, {
        title: "Ny leveranse",
        startDate: "2026-11-10",
        endDate: "2026-12-10",
        lifecycleStatus: "planned",
        priority: "medium",
      }),
    );
    await waitFor(() => expect(fetchTeamProjects).toHaveBeenCalledTimes(2));
  });

  it("keeps the form open and shows a server failure when a save is refused", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    writeTeamProject.mockResolvedValue({ status: "forbidden" });
    await renderRoadmap();
    fireEvent.click(leadButton("Rediger: Demo – Leveranse"));
    fireEvent.click(screen.getByRole("button", { name: "Lagre prosjekt" }));

    await waitFor(() => expect(screen.getByText("Bare teamledere kan endre prosjekter.")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Rediger prosjekt" })).toBeTruthy();
  });

  it("archives a project through the lead write path and refreshes the plan", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    writeTeamProject.mockResolvedValue({ status: "ok", project: { ...ACTIVE_DEMO, archived: true } });
    await renderRoadmap();
    fireEvent.click(leadButton("Arkiver: Demo – Leveranse"));

    await waitFor(() => expect(writeTeamProject).toHaveBeenCalledWith("token-1", "team-1", "archive", "p-1", null));
    await waitFor(() => expect(fetchTeamProjects).toHaveBeenCalledTimes(2));
  });

  it("restores an archived project from the archived list", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    writeTeamProject.mockResolvedValue({ status: "ok", project: { ...ARCHIVED_OLD, archived: false } });
    await renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "Vis arkiverte prosjekter" }));
    fireEvent.click(screen.getByRole("button", { name: "Gjenopprett: Gammelt prosjekt" }));

    await waitFor(() => expect(writeTeamProject).toHaveBeenCalledWith("token-1", "team-1", "restore", "p-3", null));
  });

  it("keeps archived projects out of the plan bars", async () => {
    await renderRoadmap();

    expect(screen.queryByText("Gammelt prosjekt")).toBeNull();
    expect(screen.getAllByTestId("gantt-bar")).toHaveLength(2);
  });

  it("names each participation bar with its member, project and exact dates", async () => {
    await renderRoadmap();
    const rows = screen.getAllByTestId("participation-row");

    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Anna Sørensen")]));
    expect(screen.getByRole("img", { name: "Anna Sørensen: Demo – Leveranse, 1. nov 2026 – 30. nov 2026" })).toBeTruthy();
    expect(screen.getByText("Medlem uten navn")).toBeTruthy();
  });

  it("lists each project once in the participation legend instead of repeating assignments as text", async () => {
    await renderRoadmap();
    const legend = screen.getByRole("list", { name: "Prosjekter i deltakelsen" });

    expect(within(legend).getByText("Observerbarhet")).toBeTruthy();
    expect(within(legend).getByText("Demo – Leveranse")).toBeTruthy();
    // The dates appear once, in the tooltip of the bar that owns them, not in a repeated list.
    expect(screen.getAllByText("Demo – Leveranse: 1. nov 2026 – 30. nov 2026")).toHaveLength(1);
  });

  it("hides the plan-with-participation button from ordinary members", async () => {
    await renderRoadmap();

    expect(screen.queryByRole("button", { name: "Planlegg deltakelse" })).toBeNull();
  });

  it("lets a team lead plan a participation and refreshes only the participation timeline", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    writeProjectParticipation.mockResolvedValue({
      status: "ok",
      participation: { ...PARTICIPATION_ANNA, participationId: "new-1", projectId: "p-2", startDate: "2027-01-04", endDate: "2027-01-20" },
    });
    fetchAssignableMembers.mockResolvedValue({ status: "ok", members: [{ memberRef: VALID_MEMBER_REF, displayName: "Anna Sørensen" }] });
    await renderRoadmap();
    const projectCallsBefore = fetchTeamProjects.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Planlegg deltakelse" }));
    fireEvent.change(screen.getByLabelText("Medlem"), { target: { value: VALID_MEMBER_REF } });
    fireEvent.change(screen.getByLabelText("Prosjekt"), { target: { value: "p-2" } });
    fireEvent.change(screen.getByLabelText("Fra dato"), { target: { value: "2027-01-04" } });
    fireEvent.change(screen.getByLabelText("Til dato"), { target: { value: "2027-01-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Lagre deltakelse" }));

    await waitFor(() =>
      expect(writeProjectParticipation).toHaveBeenCalledWith("token-1", "team-1", "p-2", "create", null, {
        memberRef: VALID_MEMBER_REF,
        startDate: "2027-01-04",
        endDate: "2027-01-20",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Lagre deltakelse" })).toBeNull());
    // The project list is not reloaded: only the participation reads run again.
    expect(fetchTeamProjects.mock.calls.length).toBe(projectCallsBefore);
  });

  it("refuses an invalid participation before any write is sent", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    await renderRoadmap();

    fireEvent.click(screen.getByRole("button", { name: "Planlegg deltakelse" }));
    fireEvent.click(screen.getByRole("button", { name: "Lagre deltakelse" }));

    expect(screen.getByText("Velg et medlem.")).toBeTruthy();
    expect(screen.getByText("Velg et prosjekt.")).toBeTruthy();
    expect(writeProjectParticipation).not.toHaveBeenCalled();
  });

  it("asks for confirmation before removing an assignment and sends one remove request", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    writeProjectParticipation.mockResolvedValue({ status: "ok", participation: { ...PARTICIPATION_ANNA, archived: true } });
    await renderRoadmap();

    fireEvent.click(screen.getByRole("button", { name: /^Anna Sørensen: Demo – Leveranse, 1\. nov 2026 – 30\. nov 2026\./ }));
    fireEvent.click(screen.getByRole("button", { name: "Fjern deltakelse" }));
    expect(writeProjectParticipation).not.toHaveBeenCalled();
    expect(screen.getByText("Deltakelsen fjernes fra tidslinjen. Medlemmet og prosjektet beholdes.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ja, fjern deltakelsen" }));
    await waitFor(() => expect(writeProjectParticipation).toHaveBeenCalledWith("token-1", "team-1", "p-1", "remove", "a-1", null));
  });

  /** An existing assignment with a real member reference, so the member select can show it. */
  const EDITABLE_ANNA = { ...PARTICIPATION_ANNA, memberRef: VALID_MEMBER_REF };
  const MARIUS_REF = "tvwxyz0123456789abcdefghjk";
  const MEMBERS_TWO = {
    status: "ok",
    members: [
      { memberRef: VALID_MEMBER_REF, displayName: "Anna Sørensen" },
      { memberRef: MARIUS_REF, displayName: "Marius Kristoffersen" },
    ],
  };

  function openEditForAnna() {
    return fireEvent.click(screen.getByRole("button", { name: /^Anna Sørensen: Demo – Leveranse, 1\. nov 2026 – 30\. nov 2026\./ }));
  }

  it("opens an existing assignment with its current member, project and dates, and names the record", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    fetchAssignableMembers.mockResolvedValue(MEMBERS_TWO);
    fetchProjectParticipations.mockImplementation(okParticipations([EDITABLE_ANNA, PARTICIPATION_UNNAMED]));
    await renderRoadmap();

    openEditForAnna();

    expect(screen.getByRole("heading", { name: "Rediger prosjektdeltakelse" })).toBeTruthy();
    expect((screen.getByLabelText("Medlem") as HTMLSelectElement).value).toBe(VALID_MEMBER_REF);
    expect((screen.getByLabelText("Prosjekt") as HTMLSelectElement).value).toBe("p-1");
    expect((screen.getByLabelText("Fra dato") as HTMLInputElement).value).toBe("2026-11-01");
    expect((screen.getByLabelText("Til dato") as HTMLInputElement).value).toBe("2026-11-30");
    expect(screen.getByText("Redigerer deltakelsen for Anna Sørensen i Demo – Leveranse.")).toBeTruthy();
  });

  it("moves an assignment to another member and project in one save, and shows the persisted result on the timeline", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    fetchAssignableMembers.mockResolvedValue(MEMBERS_TWO);
    let persisted = [EDITABLE_ANNA, PARTICIPATION_UNNAMED];
    fetchProjectParticipations.mockImplementation((_token: string, _team: string, projectId: string) => ({
      status: "ok",
      participations: persisted.filter((item) => item.projectId === projectId),
      truncated: false,
    }));
    const moved = { ...EDITABLE_ANNA, memberRef: MARIUS_REF, projectId: "p-2", startDate: "2026-12-01", endDate: "2026-12-20" };
    writeProjectParticipation.mockImplementation(async () => {
      persisted = [moved, PARTICIPATION_UNNAMED];
      return { status: "ok", participation: moved };
    });
    await renderRoadmap();
    const projectReadsBefore = fetchTeamProjects.mock.calls.length;

    openEditForAnna();
    fireEvent.change(screen.getByLabelText("Medlem"), { target: { value: MARIUS_REF } });
    fireEvent.change(screen.getByLabelText("Prosjekt"), { target: { value: "p-2" } });
    fireEvent.change(screen.getByLabelText("Fra dato"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Til dato"), { target: { value: "2026-12-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Lagre endringer" }));

    await waitFor(() =>
      expect(writeProjectParticipation).toHaveBeenCalledWith("token-1", "team-1", "p-1", "update", "a-1", {
        memberRef: MARIUS_REF,
        projectId: "p-2",
        startDate: "2026-12-01",
        endDate: "2026-12-20",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Rediger prosjektdeltakelse" })).toBeNull());
    // The bar now belongs to the new member and the new project, with the new dates. The old bar is gone.
    expect(screen.getByRole("button", { name: /^Marius Kristoffersen: Observerbarhet, 1\. des 2026 – 20\. des 2026\./ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Anna Sørensen: Demo – Leveranse, 1\. nov 2026/ })).toBeNull();
    // Only participations were re-read; the project plan was not reloaded.
    expect(fetchTeamProjects.mock.calls.length).toBe(projectReadsBefore);
  });

  it("keeps the form open and shows the server's refusal when the save is rejected", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    fetchAssignableMembers.mockResolvedValue(MEMBERS_TWO);
    fetchProjectParticipations.mockImplementation(okParticipations([EDITABLE_ANNA, PARTICIPATION_UNNAMED]));
    writeProjectParticipation.mockResolvedValue({ status: "error", error: "invalid_member" });
    await renderRoadmap();

    openEditForAnna();
    fireEvent.click(screen.getByRole("button", { name: "Lagre endringer" }));

    await waitFor(() => expect(screen.getByText("Medlemmet er ikke lenger en del av teamet.")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Rediger prosjektdeltakelse" })).toBeTruthy();
  });

  it("refuses an end date before the start date on edit, before any write is sent", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(true));
    fetchAssignableMembers.mockResolvedValue(MEMBERS_TWO);
    fetchProjectParticipations.mockImplementation(okParticipations([EDITABLE_ANNA, PARTICIPATION_UNNAMED]));
    await renderRoadmap();

    openEditForAnna();
    fireEvent.change(screen.getByLabelText("Fra dato"), { target: { value: "2026-11-15" } });
    fireEvent.change(screen.getByLabelText("Til dato"), { target: { value: "2026-11-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Lagre endringer" }));

    expect(screen.getByText("Sluttdato kan ikke være før startdato.")).toBeTruthy();
    expect(writeProjectParticipation).not.toHaveBeenCalled();
  });

  it("gives ordinary members no edit control on any assignment bar", async () => {
    fetchTeamProjects.mockResolvedValue(okProjects(false));
    fetchAssignableMembers.mockResolvedValue(MEMBERS_TWO);
    fetchProjectParticipations.mockImplementation(okParticipations([EDITABLE_ANNA, PARTICIPATION_UNNAMED]));
    await renderRoadmap();

    expect(screen.queryByRole("button", { name: /Rediger deltakelse/ })).toBeNull();
    expect(screen.getAllByRole("img", { name: /Anna Sørensen: Demo – Leveranse/ }).length).toBeGreaterThan(0);
  });

  it("does not show utilization, capacity or performance values in the participation section", async () => {
    await renderRoadmap();
    const section = screen.getByRole("region", { name: "Teammedlemmers prosjektdeltakelse" });

    expect(section.textContent).not.toMatch(/kapasitet|utnytt|produktivitet|%/i);
  });

  it("shows a participation error without hiding the project plan", async () => {
    fetchProjectParticipations.mockResolvedValue({ status: "read_failed" });
    await renderRoadmap();

    expect(screen.getByText("Deltakelsen kunne ikke lastes.")).toBeTruthy();
    expect(screen.getAllByTestId("gantt-bar")).toHaveLength(2);
  });

  it("renders participation without names when the member read fails", async () => {
    fetchAssignableMembers.mockResolvedValue({ status: "read_failed" });
    await renderRoadmap();

    expect(screen.getByText("Navn på medlemmer kunne ikke lastes. Deltakelse vises uten navn.")).toBeTruthy();
    expect(screen.getAllByText("Medlem uten navn").length).toBeGreaterThan(0);
  });
});

/**
 * Desktop and narrow-screen renderings both contain the lead actions; CSS hides the narrow copy in browsers, but jsdom
 * has no stylesheet. The first match is the desktop control (document order), which is the one under test.
 */
function leadButton(name: string): HTMLElement {
  const matches = screen.getAllByRole("button", { name });
  const first = matches[0];
  if (!first) throw new Error(`No button named ${name}`);
  return first;
}

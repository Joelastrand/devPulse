// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const fetchTeamProjects = vi.fn();
const fetchProjectParticipations = vi.fn();
const fetchAssignableMembers = vi.fn();
const writeTeamProject = vi.fn();

vi.mock("../client/team-projects-gateway", () => ({
  fetchTeamProjects: (...args: unknown[]) => fetchTeamProjects(...args),
  fetchProjectParticipations: (...args: unknown[]) => fetchProjectParticipations(...args),
  fetchAssignableMembers: (...args: unknown[]) => fetchAssignableMembers(...args),
  writeTeamProject: (...args: unknown[]) => writeTeamProject(...args),
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
    const bars = screen.getAllByTestId("gantt-bar");

    // Demo – Leveranse: 1 Nov – 31 Dec = 61 of 181 days, starting at the window's first day.
    expect(parseFloat(bars[0]?.style.left ?? "NaN")).toBeCloseTo(0);
    expect(parseFloat(bars[0]?.style.width ?? "NaN")).toBeCloseTo((61 / 181) * 100);
    // Observerbarhet: 15 Dec – 28 Feb = 76 days, starting at day 44 (0-based).
    expect(parseFloat(bars[1]?.style.left ?? "NaN")).toBeCloseTo((44 / 181) * 100);
    expect(parseFloat(bars[1]?.style.width ?? "NaN")).toBeCloseTo((76 / 181) * 100);
  });

  it("switches to the three-month window and re-positions bars from the same dates", async () => {
    await renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "3 måneder" }));

    expect(screen.getByRole("button", { name: "3 måneder" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "6 måneder" }).getAttribute("aria-pressed")).toBe("false");
    const bars = screen.getAllByTestId("gantt-bar");
    // Window is Nov 2026 – Jan 2027 (92 days). Demo – Leveranse covers 61 days from the start.
    expect(parseFloat(bars[0]?.style.width ?? "NaN")).toBeCloseTo((61 / 92) * 100);
    // Observerbarhet is clipped at the window end: 15 Dec – 31 Jan = 48 days.
    expect(parseFloat(bars[1]?.style.width ?? "NaN")).toBeCloseTo((48 / 92) * 100);
  });

  it("shows the today marker with its date when today is inside the window", async () => {
    await renderRoadmap();

    expect(screen.getByText("I dag: 6. nov 2026")).toBeTruthy();
    expect(screen.queryByText("I dag er utenfor valgt periode: 6. nov 2026")).toBeNull();
  });

  it("labels each bar with its project, dates and clipping", async () => {
    await renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "3 måneder" }));

    const bar = screen.getAllByTestId("gantt-bar")[1];
    expect(within(bar as HTMLElement).getByText(/Observerbarhet: 15\. des 2026 til 28\. feb 2027, fortsetter etter valgt periode/)).toBeTruthy();
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

  it("shows participation by member, with an unnamed member and the overlap flag as text", async () => {
    await renderRoadmap();
    const rows = screen.getAllByTestId("participation-row");

    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Anna Sørensen")]));
    expect(screen.getByText("Medlem uten navn", { selector: "span.font-medium" })).toBeTruthy();
    expect(screen.getByText("Overlapper med annen deltakelse")).toBeTruthy();
    expect(screen.getByText("Demo – Leveranse: 1. nov 2026 – 30. nov 2026")).toBeTruthy();
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

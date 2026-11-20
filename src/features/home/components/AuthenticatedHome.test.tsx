// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure } from "../../../components/ui/heading-structure";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { todayIsoInOslo } from "./HomePanels";
import { teamsCopy } from "../../teams/copy";

const observeIdTokenMock = vi.fn();
const fetchGoalsMock = vi.fn();
const fetchConversationListMock = vi.fn();
const fetchTaskBoardMock = vi.fn();
const fetchTeamsOverviewMock = vi.fn();
const fetchTeamResultsMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../../personal-goals/client/goals-gateway", () => ({ fetchGoals: fetchGoalsMock }));
vi.mock("../../development-conversations/client/conversations-gateway", () => ({
  fetchInvitableColleagues: async () => ({ status: "ok", response: { colleagues: [], truncated: false } }),
  fetchConversationList: fetchConversationListMock,
}));
vi.mock("../../personal-tasks/client/tasks-gateway", () => ({ fetchTaskBoard: fetchTaskBoardMock }));
vi.mock("../../teams/client/teams-overview-gateway", () => ({
  fetchTeamsOverview: fetchTeamsOverviewMock,
  requestTeamAccess: vi.fn(),
}));
vi.mock("../../results/client/team-results-gateway", () => ({ fetchTeamResults: fetchTeamResultsMock }));

const { AuthenticatedHome } = await import("./AuthenticatedHome");

// Dates are relative to the real calendar so the due-date rules are exercised without a clock mock.
const TODAY = todayIsoInOslo();
const PAST = "2000-01-01";
const SOON = addDaysIso(TODAY, 3);
const FAR = "2999-01-01";

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function signedIn() {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("token");
    return () => {};
  });
}

const goal = (id: string, title: string, status: "active" | "completed", targetDate: string | null) => ({
  id,
  title,
  status,
  treeId: null,
  areaName: null,
  areaAvailable: false,
  targetDate,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
});

const summary = (conversationId: string, title: string, status: "open" | "completed", plannedFor: string | null) => ({
  kind: "summary" as const,
  conversation: {
    conversationId,
    title,
    status,
    plannedFor,
    participant: { state: "accepted" as const, displayName: "Kari Nordmann" },
    sharedGoalCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
});

const task = (
  id: string,
  title: string,
  status: "backlog" | "doing" | "blocked" | "done",
  dueDate: string | null,
  priority: "low" | "normal" | "high" | null = null,
) => ({
  id,
  title,
  description: null,
  notes: null,
  status,
  priority,
  dueDate,
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: status === "done" ? "2026-01-02T00:00:00.000Z" : null,
});

const publishedResult = (surveyId: string, date: string, flow: number, stress: number, fun: number) => ({
  surveyId,
  date,
  minimumResponses: 5,
  status: "published" as const,
  count: 6,
  mean: { flow, stress, fun },
});

function healthyReads() {
  fetchGoalsMock.mockResolvedValue({
    status: "ok",
    response: {
      goals: [
        goal("g1", "Bli tryggere på teknisk fasilitering", "active", "2026-12-01"),
        goal("g2", "Fordype meg i teststrategi", "active", null),
        goal("g3", "Ferdig mål", "completed", null),
      ],
      recoveryItems: [],
      truncated: false,
      skillOptions: [],
    },
  });
  fetchConversationListMock.mockResolvedValue({
    status: "ok",
    response: {
      owned: {
        items: [
          summary("c-late", "Senere samtale", "open", "2999-12-20"),
          summary("c-next", "Utviklingssamtale med Kari", "open", "2999-11-10"),
          summary("c-done", "Avsluttet", "completed", "2000-10-01"),
        ],
        truncated: false,
      },
      participating: { items: [], truncated: false },
    },
  });
  fetchTaskBoardMock.mockResolvedValue({
    status: "ok",
    board: { tasks: [], completedVisibility: "last7" },
  });
  fetchTeamsOverviewMock.mockResolvedValue({
    status: "ok",
    teams: [{ teamId: "t1", name: "Demo Team", relationship: "member", isMember: true, canOpen: true }],
  });
  fetchTeamResultsMock.mockResolvedValue({ status: "ok", teamId: "t1", results: [] });
}

/** The bordered section that a level-2 heading names. */
function panel(name: string): HTMLElement {
  return screen.getByRole("heading", { name }).closest("section") as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthenticatedHome structure", () => {
  it("renders one compact Hjem heading and the four sections, without a name greeting", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);

    expect(await screen.findByRole("heading", { level: 1, name: "Hjem" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Din oversikt over det som er viktig nå.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Dette er viktig nå" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Min utvikling" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mine team" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Siste nytt fra teamet" })).toBeTruthy();
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });

  it("orders the attention section before development, and development before the team sections", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);

    const attention = await screen.findByRole("heading", { name: "Dette er viktig nå" });
    const development = screen.getByRole("heading", { name: "Min utvikling" });
    const teams = screen.getByRole("heading", { name: "Mine team" });
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(attention, development)).toBe(true);
    expect(follows(development, teams)).toBe(true);
  });

  it("does not render the trend chart, the navigation cards, the next-steps panel or the team illustration", async () => {
    signedIn();
    healthyReads();
    const { container } = render(<AuthenticatedHome />);
    await screen.findByRole("heading", { name: "Min utvikling" });
    await waitFor(() => expect(fetchTeamResultsMock).toHaveBeenCalled());

    expect(screen.queryByRole("heading", { name: "Utvikling over tid" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Trendvisualisering" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Neste steg" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Snarveier" })).toBeNull();
    expect(container.querySelector(".recharts-responsive-container")).toBeNull();
    expect(container.querySelector(".h-64")).toBeNull();
  });

  it("keeps the page free of invented metrics, percentages and deltas", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);
    await screen.findByRole("heading", { name: "Min utvikling" });

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\+0,\d/);
    expect(text).not.toMatch(/\d+\s?%/);
    expect(text).not.toMatch(/Kommende aktivitet/i);
  });
});

describe("AuthenticatedHome: Dette er viktig nå", () => {
  it("shows the earliest open conversation once, with a single link to it", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);

    const section = panel("Dette er viktig nå");
    await waitFor(() => expect(within(section).getByText("Utviklingssamtale med Kari")).toBeTruthy());
    expect(within(section).queryByText("Senere samtale")).toBeNull();
    expect(within(section).queryByText("Avsluttet")).toBeNull();
    // One action per conversation, named by its visible label.
    expect(within(section).getByRole("link", { name: "Åpne samtale" }).getAttribute("href")).toBe("/me/conversations/c-next");
  });

  it("shows overdue and due-soon tasks with a text label, and excludes done and distant tasks", async () => {
    signedIn();
    healthyReads();
    fetchTaskBoardMock.mockResolvedValue({
      status: "ok",
      board: {
        tasks: [
          task("t-over", "Forfalt oppgave", "doing", PAST),
          task("t-soon", "Snart oppgave", "backlog", SOON),
          task("t-far", "Langt frem", "backlog", FAR),
          task("t-done", "Ferdig oppgave", "done", PAST),
        ],
        completedVisibility: "last7",
      },
    });
    render(<AuthenticatedHome />);

    const section = panel("Dette er viktig nå");
    await waitFor(() => expect(within(section).getByText("Forfalt oppgave")).toBeTruthy());
    expect(within(section).getByText("Forfalt")).toBeTruthy();
    expect(within(section).getByText("Snart oppgave")).toBeTruthy();
    expect(within(section).getByText("Forfaller")).toBeTruthy();
    expect(within(section).queryByText("Langt frem")).toBeNull();
    expect(within(section).queryByText("Ferdig oppgave")).toBeNull();
  });

  it("limits the section to three items and puts the conversation first", async () => {
    signedIn();
    healthyReads();
    fetchTaskBoardMock.mockResolvedValue({
      status: "ok",
      board: {
        tasks: [
          task("a", "Oppgave A", "doing", PAST),
          task("b", "Oppgave B", "doing", PAST),
          task("c", "Oppgave C", "doing", PAST),
        ],
        completedVisibility: "last7",
      },
    });
    render(<AuthenticatedHome />);

    const section = panel("Dette er viktig nå");
    await waitFor(() => expect(within(section).getByText("Utviklingssamtale med Kari")).toBeTruthy());
    expect(within(section).getAllByRole("listitem")).toHaveLength(3);
    expect(within(section).queryByText("Oppgave C")).toBeNull();
  });

  it("shows the empty message only when every source loaded and nothing needs attention", async () => {
    signedIn();
    healthyReads();
    fetchConversationListMock.mockResolvedValue({
      status: "ok",
      response: { owned: { items: [], truncated: false }, participating: { items: [], truncated: false } },
    });
    render(<AuthenticatedHome />);

    const section = panel("Dette er viktig nå");
    await waitFor(() =>
      expect(within(section).getByText("Ingen oppgaver som trenger oppmerksomhet akkurat nå.")).toBeTruthy(),
    );
  });

  it("does not claim there is nothing to do when the task read failed", async () => {
    signedIn();
    healthyReads();
    fetchTaskBoardMock.mockResolvedValue({ status: "read_failed" });
    fetchConversationListMock.mockResolvedValue({
      status: "ok",
      response: { owned: { items: [], truncated: false }, participating: { items: [], truncated: false } },
    });
    render(<AuthenticatedHome />);

    const section = panel("Dette er viktig nå");
    await waitFor(() => expect(within(section).getByText(/Kunne ikke laste dette nå/)).toBeTruthy());
    expect(within(section).queryByText(/Ingen oppgaver som trenger/)).toBeNull();
  });
});

describe("AuthenticatedHome: Min utvikling", () => {
  it("shows open counts for goals, conversations and tasks, each with a direct link", async () => {
    signedIn();
    healthyReads();
    fetchTaskBoardMock.mockResolvedValue({
      status: "ok",
      board: {
        tasks: [task("a", "Åpen", "backlog", null), task("b", "Ferdig", "done", null)],
        completedVisibility: "last7",
      },
    });
    render(<AuthenticatedHome />);

    const section = panel("Min utvikling");
    // Two active goals and two open conversations share the value 2; one open task shows 1.
    await waitFor(() => expect(within(section).getAllByText("2", { selector: "p" })).toHaveLength(2));
    expect(within(section).getAllByText("1", { selector: "p" })).toHaveLength(1);
    expect(within(section).getByRole("link", { name: "Se alle mål" }).getAttribute("href")).toBe("/me/goals");
    expect(within(section).getByRole("link", { name: "Se samtaler" }).getAttribute("href")).toBe("/me/conversations");
    expect(within(section).getByRole("link", { name: "Se oppgaver" }).getAttribute("href")).toBe("/tasks");
  });

  it("isolates a failed goals read: its tile shows an error, not zero, and the other sections still render", async () => {
    signedIn();
    healthyReads();
    fetchGoalsMock.mockResolvedValue({ status: "read_failed" });
    render(<AuthenticatedHome />);

    const section = panel("Min utvikling");
    await waitFor(() => expect(within(section).getByText(/Kunne ikke laste dette nå/)).toBeTruthy());
    const goalsTile = within(section).getByText("Aktive mål").closest("li") as HTMLElement;
    expect(within(goalsTile).queryByText("0", { selector: "p" })).toBeNull();
    expect(within(goalsTile).queryByText(/\d/, { selector: "p" })).toBeNull();
    expect(panel("Dette er viktig nå")).toBeTruthy();
    expect(within(panel("Dette er viktig nå")).getByText("Utviklingssamtale med Kari")).toBeTruthy();
  });

  it("a rejected goals read leaves no tile stuck on loading", async () => {
    signedIn();
    healthyReads();
    fetchGoalsMock.mockRejectedValue(new Error("network"));
    render(<AuthenticatedHome />);

    const section = panel("Min utvikling");
    await waitFor(() => expect(within(section).getByText(/Kunne ikke laste dette nå/)).toBeTruthy());
    expect(within(section).queryByText("Laster…")).toBeNull();
  });
});

describe("AuthenticatedHome: Mine team and team updates", () => {
  it("links each member team directly and offers no request-access control on Home", async () => {
    signedIn();
    healthyReads();
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "t1", name: "Demo Team", relationship: "member", isMember: true, canOpen: true },
        { teamId: "t9", name: "Other Team", relationship: "none", isMember: false, canOpen: false },
      ],
    });
    render(<AuthenticatedHome />);

    const section = panel("Mine team");
    await waitFor(() => expect(within(section).getByText("Demo Team")).toBeTruthy());
    expect(within(section).getByRole("link", { name: "Åpne team" }).getAttribute("href")).toBe("/teams/t1");
    expect(within(section).queryByText("Other Team")).toBeNull();
    expect(screen.queryByRole("button", { name: /be om tilgang/i })).toBeNull();
    // A single team needs no "all teams" shortcut.
    expect(within(section).queryByRole("link", { name: "Se alle team" })).toBeNull();
  });

  it("shows an explicit empty state with a link to the team list when the viewer has no team", async () => {
    signedIn();
    healthyReads();
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "t9", name: "Other Team", relationship: "none", isMember: false, canOpen: false }],
    });
    render(<AuthenticatedHome />);

    const section = panel("Mine team");
    await waitFor(() => expect(within(section).getByText("Du er ikke medlem av et team ennå.")).toBeTruthy());
    expect(within(section).getByRole("link", { name: "Se teamene" }).getAttribute("href")).toBe("/teams");
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("names the team and shows only the date of the latest published survey, never its values", async () => {
    signedIn();
    healthyReads();
    fetchTeamResultsMock.mockResolvedValue({
      status: "ok",
      teamId: "t1",
      results: [
        publishedResult("s-old", "2026-08-01", 2.1, 2.2, 2.3),
        publishedResult("s-new", "2026-10-15", 3.9, 2.5, 4.1),
      ],
    });
    render(<AuthenticatedHome />);

    const section = panel("Siste nytt fra teamet");
    await waitFor(() => expect(within(section).getByText(/Siste publiserte måling/)).toBeTruthy());
    expect(within(section).getByText("Demo Team")).toBeTruthy();
    expect(within(section).getByRole("link", { name: "Se resultater" }).getAttribute("href")).toBe("/teams/t1/results");
    expect(section.textContent).not.toMatch(/\d\.\d/);
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("token", "t1");
  });

  it("describes a suppressed latest survey as too few answers, never as a score or zero", async () => {
    signedIn();
    healthyReads();
    fetchTeamResultsMock.mockResolvedValue({
      status: "ok",
      teamId: "t1",
      results: [{ surveyId: "s1", date: "2026-10-01", minimumResponses: 5, status: "insufficient" }],
    });
    render(<AuthenticatedHome />);

    const section = panel("Siste nytt fra teamet");
    await waitFor(() => expect(within(section).getByText("Siste måling har for få svar til å vises.")).toBeTruthy());
    expect(section.textContent).not.toMatch(/\d\.\d/);
    expect(section.textContent).not.toMatch(/Siste publiserte/);
  });

  it("shows a read error in the team update while the other sections still render", async () => {
    signedIn();
    healthyReads();
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });
    render(<AuthenticatedHome />);

    const section = panel("Siste nytt fra teamet");
    await waitFor(() => expect(within(section).getByText(/Kunne ikke laste dette nå/)).toBeTruthy());
    expect(panel("Mine team")).toBeTruthy();
    expect(panel("Min utvikling")).toBeTruthy();
  });

  it("does not show a team update or a no-results message while the teams read has failed", async () => {
    signedIn();
    healthyReads();
    fetchTeamsOverviewMock.mockResolvedValue({ status: "read_failed" });
    render(<AuthenticatedHome />);

    const section = panel("Siste nytt fra teamet");
    await waitFor(() => expect(within(section).getByText(/Kunne ikke laste dette nå/)).toBeTruthy());
    expect(within(section).queryByText(/Det finnes ingen målinger/)).toBeNull();
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("does not let a late response for the previous team overwrite the current team's update", async () => {
    let currentToken: string | null = "token-a";
    const subscribers = new Set<(token: string | null) => void>();
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      subscribers.add(callback);
      callback(currentToken);
      return () => subscribers.delete(callback);
    });
    const emitToken = (token: string) => {
      currentToken = token;
      for (const callback of [...subscribers]) callback(token);
    };
    healthyReads();
    const teamAResolvers: Array<(value: unknown) => void> = [];
    fetchTeamResultsMock.mockImplementation((_token: string, teamId: string) => {
      if (teamId === "t1") return new Promise((resolve) => teamAResolvers.push(resolve));
      return Promise.resolve({
        status: "ok",
        teamId: "t2",
        results: [publishedResult("s-b", "2026-10-15", 4.4, 4.5, 4.6)],
      });
    });
    fetchTeamsOverviewMock.mockImplementation(async (token: string) =>
      token === "token-b"
        ? { status: "ok", teams: [{ teamId: "t2", name: "Other Team", relationship: "member", isMember: true, canOpen: true }] }
        : { status: "ok", teams: [{ teamId: "t1", name: "Demo Team", relationship: "member", isMember: true, canOpen: true }] },
    );
    render(<AuthenticatedHome />);
    await waitFor(() => expect(teamAResolvers.length).toBe(1));

    act(() => emitToken("token-b"));

    const section = panel("Siste nytt fra teamet");
    await waitFor(() => expect(within(section).getByText("Other Team")).toBeTruthy());
    await waitFor(() => expect(within(section).getByRole("link", { name: "Se resultater" }).getAttribute("href")).toBe("/teams/t2/results"));

    await act(async () => {
      teamAResolvers[0]({
        status: "ok",
        teamId: "t1",
        results: [publishedResult("s-a", "2026-10-20", 1.1, 1.2, 1.3)],
      });
    });
    expect(within(section).getByRole("link", { name: "Se resultater" }).getAttribute("href")).toBe("/teams/t2/results");
    expect(within(section).queryByText("Demo Team")).toBeNull();
  });

  it("calls each home read once per load", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);

    await screen.findByRole("heading", { name: "Min utvikling" });
    await waitFor(() => expect(fetchTeamResultsMock).toHaveBeenCalledTimes(1));
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);
    expect(fetchConversationListMock).toHaveBeenCalledTimes(1);
    expect(fetchTaskBoardMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1);
  });
});

describe("AuthenticatedHome V2 layout (home-v2 reference)", () => {
  const memberTeam = (teamId: string, name: string, relationship: "teamadmin" | "member") => ({
    teamId,
    name,
    relationship,
    isMember: true,
    canOpen: true,
  });

  it("lists every member team with its own link and relationship badge, not only the first", async () => {
    signedIn();
    healthyReads();
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [memberTeam("t1", "Demo Team", "teamadmin"), memberTeam("t2", "Andre Team", "member")],
    });
    render(<AuthenticatedHome />);

    const section = panel("Mine team");
    await waitFor(() => expect(within(section).getByText("Andre Team")).toBeTruthy());
    expect(within(section).getAllByRole("link", { name: "Åpne team" })).toHaveLength(2);
    expect(within(section).getByText(teamsCopy.relationshipLabels.teamadmin)).toBeTruthy();
    expect(within(section).getByText(teamsCopy.relationshipLabels.member)).toBeTruthy();
    expect(within(section).queryByRole("link", { name: "Se alle team" })).toBeNull();
  });

  it("adds the all-teams shortcut only when there are more than three member teams", async () => {
    signedIn();
    healthyReads();
    fetchTeamsOverviewMock.mockResolvedValue({
      status: "ok",
      teams: [
        memberTeam("t1", "Team A", "member"),
        memberTeam("t2", "Team B", "member"),
        memberTeam("t3", "Team C", "member"),
        memberTeam("t4", "Team D", "member"),
      ],
    });
    render(<AuthenticatedHome />);

    const section = panel("Mine team");
    await waitFor(() => expect(within(section).getByText("Team D")).toBeTruthy());
    expect(within(section).getByRole("link", { name: "Se alle team" }).getAttribute("href")).toBe("/teams");
  });

  it("keeps the decorative waves out of the accessibility tree", async () => {
    signedIn();
    healthyReads();
    const { container } = render(<AuthenticatedHome />);
    await screen.findByRole("heading", { name: "Min utvikling" });

    const decorative = Array.from(container.querySelectorAll("svg[aria-hidden='true']"));
    expect(decorative.length).toBeGreaterThanOrEqual(2);
    for (const svg of decorative) {
      expect(svg.getAttribute("focusable")).toBe("false");
    }
  });
});

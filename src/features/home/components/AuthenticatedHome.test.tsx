// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure } from "../../../components/ui/heading-structure";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
const fetchGoalsMock = vi.fn();
const fetchConversationListMock = vi.fn();
const fetchOwnRoleTargetMock = vi.fn();
const fetchOwnProfileMock = vi.fn();
const fetchTeamsOverviewMock = vi.fn();
const requestTeamAccessMock = vi.fn();
const fetchTeamResultsMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../../personal-goals/client/goals-gateway", () => ({ fetchGoals: fetchGoalsMock }));
vi.mock("../../development-conversations/client/conversations-gateway", () => ({
  fetchConversationList: fetchConversationListMock,
}));
vi.mock("../../role-profiles/client/role-target-gateway", () => ({ fetchOwnRoleTarget: fetchOwnRoleTargetMock }));
vi.mock("../../profiles/client/profile-gateway", () => ({ fetchOwnProfile: fetchOwnProfileMock }));
vi.mock("../../teams/client/teams-overview-gateway", () => ({
  fetchTeamsOverview: fetchTeamsOverviewMock,
  requestTeamAccess: requestTeamAccessMock,
}));
vi.mock("../../results/client/team-results-gateway", () => ({ fetchTeamResults: fetchTeamResultsMock }));
vi.mock("../../../components/nav/SidebarLandscape", () => ({ SidebarLandscape: () => null }));

const { AuthenticatedHome } = await import("./AuthenticatedHome");

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

function healthyReads() {
  fetchOwnProfileMock.mockResolvedValue({ status: "ok", displayName: "Joel Åstrand" });
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
          summary("c-late", "Senere samtale", "open", "2026-12-20"),
          summary("c-next", "Utviklingssamtale med Kari", "open", "2026-11-10"),
          summary("c-done", "Avsluttet", "completed", "2026-10-01"),
        ],
        truncated: false,
      },
      participating: { items: [], truncated: false },
    },
  });
  fetchOwnRoleTargetMock.mockResolvedValue({ status: "ok", view: { status: "none" } });
  fetchTeamsOverviewMock.mockResolvedValue({
    status: "ok",
    teams: [{ teamId: "t1", name: "Demo Team", relationship: "member" }],
  });
  fetchTeamResultsMock.mockResolvedValue({ status: "ok", teamId: "t1", results: [] });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthenticatedHome composition", () => {
  it("greets the viewer by display name with one h1 and the top status cards", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);

    expect(await screen.findByRole("heading", { level: 1, name: "Hei, Joel Åstrand" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Teamets puls" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Aktivitet" })).toBeNull();
  });

  it("shows the earliest open conversation as the next conversation", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);

    const panel = await screen.findByRole("heading", { name: "Neste samtale" });
    const section = panel.closest("section") as HTMLElement;
    await waitFor(() => expect(within(section).getByText("Utviklingssamtale med Kari")).toBeTruthy());
    expect(within(section).queryByText("Senere samtale")).toBeNull();
    expect(within(section).getByRole("link", { name: "Gå til samtale" }).getAttribute("href")).toBe("/me/conversations/c-next");
  });

  it("offers the role selection action when no role is selected", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);

    expect(await screen.findByText("Ingen rolle valgt")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Velg rolle" }).getAttribute("href")).toBe("/me/skills");
  });

  it("isolates a failed read: the goals panel shows an error and other panels still render", async () => {
    signedIn();
    healthyReads();
    fetchGoalsMock.mockResolvedValue({ status: "read_failed" });
    render(<AuthenticatedHome />);

    const goalsHeading = await screen.findByRole("heading", { name: "Mine mål" });
    const goalsSection = goalsHeading.closest("section") as HTMLElement;
    await waitFor(() => expect(within(goalsSection).getByText(/Kunne ikke laste dette nå/)).toBeTruthy());
    // A failed read is never shown as a zero count.
    expect(within(goalsSection).queryByText("0")).toBeNull();
    expect(await screen.findByText("Ingen rolle valgt")).toBeTruthy();
  });

  it("a rejected read leaves no panel stuck on loading: it shows the error state", async () => {
    signedIn();
    healthyReads();
    fetchGoalsMock.mockRejectedValue(new Error("network"));
    render(<AuthenticatedHome />);

    const goalsHeading = await screen.findByRole("heading", { name: "Mine mål" });
    const goalsSection = goalsHeading.closest("section") as HTMLElement;
    await waitFor(() => expect(within(goalsSection).getByText(/Kunne ikke laste dette nå/)).toBeTruthy());
    expect(within(goalsSection).queryByText("Laster…")).toBeNull();
  });

  it("does not render excluded counters, calendar items or invented deltas", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);
    await screen.findByRole("heading", { name: "Mine mål" });

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/pågående tiltak/i);
    expect(text).not.toMatch(/nærmer seg ferdig/i);
    expect(text).not.toMatch(/Kommende aktivitet/i);
    expect(text).not.toMatch(/\+0,\d/);
    expect(text).not.toMatch(/\d+\s?%/);
  });

  it("shows the team entry linked to the team overview", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);

    const link = await screen.findByRole("link", { name: "Teamoversikt" });
    expect(link.getAttribute("href")).toBe("/teams/t1");
  });
});

describe("AuthenticatedHome team development panel", () => {
  it("renders a suppressed survey as the chart, never as a zero value", async () => {
    signedIn();
    healthyReads();
    fetchTeamResultsMock.mockResolvedValue({
      status: "ok",
      teamId: "t1",
      results: [{ surveyId: "s1", date: "2026-10-01", minimumResponses: 5, status: "insufficient" }],
    });
    render(<AuthenticatedHome />);

    expect(await screen.findByRole("heading", { name: "Trendvisualisering" })).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText(/Det finnes ingen resultater/)).toBeNull();
  });

  it("shows the read error for team results while the other panels still render", async () => {
    signedIn();
    healthyReads();
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });
    render(<AuthenticatedHome />);

    const panel = await screen.findByRole("heading", { name: "Neste steg" });
    expect(panel).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/Kunne ikke laste dette nå/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Det finnes ingen resultater/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Mine mål" })).toBeTruthy();
  });

  it("does not show the no-results copy when the teams read has failed", async () => {
    signedIn();
    healthyReads();
    fetchTeamsOverviewMock.mockResolvedValue({ status: "read_failed" });
    render(<AuthenticatedHome />);

    await screen.findByRole("heading", { name: "Mine mål" });
    await waitFor(() => expect(screen.getAllByText(/Kunne ikke laste dette nå/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Det finnes ingen resultater/)).toBeNull();
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });
});

describe("signed-in home heading structure (visual-redesign TASK-019)", () => {
  it("keeps one level-1 greeting heading and a valid hierarchy", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);
    await screen.findByRole("heading", { level: 1, name: "Hei, Joel Åstrand" });
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

describe("AuthenticatedHome composition (reference 03, visual-fidelity TASK-027)", () => {
  const publishedResult = (surveyId: string, date: string, flow: number, stress: number, fun: number) => ({
    surveyId,
    date,
    minimumResponses: 5,
    status: "published" as const,
    count: 6,
    mean: { flow, stress, fun },
  });

  it("orders the greeting band, the status row, the middle panels and the lower row", async () => {
    signedIn();
    healthyReads();
    render(<AuthenticatedHome />);

    const heading = await screen.findByRole("heading", { level: 1, name: "Hei, Joel Åstrand" });
    const statusRow = screen.getByRole("region", { name: "Teamoversikt" });
    const goalsPanel = screen.getByRole("heading", { name: "Mine mål" });
    const nextSteps = screen.getByRole("heading", { name: "Neste steg" });
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(heading, statusRow)).toBe(true);
    expect(follows(statusRow, goalsPanel)).toBe(true);
    expect(follows(goalsPanel, nextSteps)).toBe(true);
  });

  it("shows the team pulse as the latest survey's dimension means, labelled, with no overall average", async () => {
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

    const pulse = await screen.findByRole("region", { name: "Teamets puls" });
    await waitFor(() => expect(within(pulse).getByText("3.9")).toBeTruthy());
    expect(within(pulse).getByText("2.5")).toBeTruthy();
    expect(within(pulse).getByText("4.1")).toBeTruthy();
    expect(within(pulse).queryByText("2.1")).toBeNull();
  });

  it("shows the insufficient-responses label in the pulse card, never a value, for a suppressed latest survey", async () => {
    signedIn();
    healthyReads();
    fetchTeamResultsMock.mockResolvedValue({
      status: "ok",
      teamId: "t1",
      results: [{ surveyId: "s1", date: "2026-10-01", minimumResponses: 5, status: "insufficient" }],
    });
    render(<AuthenticatedHome />);

    const pulse = await screen.findByRole("region", { name: "Teamets puls" });
    await waitFor(() => expect(within(pulse).getByText("For få svar ennå")).toBeTruthy());
    expect(pulse.textContent).not.toMatch(/\d\.\d/);
  });

  it("keeps the pulse card on its read error without hiding the chart area", async () => {
    signedIn();
    healthyReads();
    fetchTeamResultsMock.mockResolvedValue({ status: "read_failed" });
    render(<AuthenticatedHome />);

    const pulse = await screen.findByRole("region", { name: "Teamets puls" });
    await waitFor(() => expect(within(pulse).getByText(/Kunne ikke laste dette nå/)).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Neste steg" })).toBeTruthy();
  });

  it("does not show a team pulse value while the teams read is still loading", async () => {
    signedIn();
    healthyReads();
    fetchTeamsOverviewMock.mockReturnValue(new Promise(() => {}));
    render(<AuthenticatedHome />);

    const pulse = await screen.findByRole("region", { name: "Teamets puls" });
    expect(within(pulse).getByText("Laster…")).toBeTruthy();
    expect(pulse.textContent).not.toMatch(/\d\.\d/);
    expect(fetchTeamResultsMock).not.toHaveBeenCalled();
  });

  it("calls each home read once per load", async () => {
    signedIn();
    healthyReads();
    fetchTeamResultsMock.mockResolvedValue({ status: "ok", teamId: "t1", results: [] });
    render(<AuthenticatedHome />);

    await screen.findByRole("heading", { name: "Mine mål" });
    await waitFor(() => expect(fetchTeamResultsMock).toHaveBeenCalledTimes(1));
    expect(fetchTeamResultsMock).toHaveBeenCalledWith("token", "t1");
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);
    expect(fetchConversationListMock).toHaveBeenCalledTimes(1);
    expect(fetchOwnRoleTargetMock).toHaveBeenCalledTimes(1);
    expect(fetchOwnProfileMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1);
  });

  it("re-runs the teams read once after a successful request-access from the home teams section", async () => {
    signedIn();
    healthyReads();
    fetchTeamsOverviewMock
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "t9", name: "Other Team", relationship: "none" }],
      })
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "t9", name: "Other Team", relationship: "request_pending" }],
      });
    requestTeamAccessMock.mockResolvedValue({ ok: true, outcome: "created" });
    render(<AuthenticatedHome />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /be om tilgang/i }));

    await screen.findByText(/forespørsel venter/i);
    expect(requestTeamAccessMock).toHaveBeenCalledWith("token", "t9");
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(2);
  });

  it("does not let a late response for the previous team overwrite the current team's pulse", async () => {
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
        ? { status: "ok", teams: [{ teamId: "t2", name: "Other Team", relationship: "member" }] }
        : { status: "ok", teams: [{ teamId: "t1", name: "Demo Team", relationship: "member" }] },
    );
    render(<AuthenticatedHome />);
    await waitFor(() => expect(teamAResolvers.length).toBe(1));

    act(() => emitToken("token-b"));

    const pulse = await screen.findByRole("region", { name: "Teamets puls" });
    await waitFor(() => expect(within(pulse).getByText("4.4")).toBeTruthy());

    await act(async () => {
      teamAResolvers[0]({
        status: "ok",
        teamId: "t1",
        results: [publishedResult("s-a", "2026-10-20", 1.1, 1.2, 1.3)],
      });
    });
    expect(within(pulse).getByText("4.4")).toBeTruthy();
    expect(within(pulse).queryByText("1.1")).toBeNull();
  });
});

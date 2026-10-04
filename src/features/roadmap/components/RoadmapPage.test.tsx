// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoadmapItemView } from "../server/list-roadmap-items";
import { queryMutationControls } from "./roadmap-test-helpers";

const observeIdTokenMock = vi.fn();
const fetchTeamsOverviewMock = vi.fn();
const fetchRoadmapItemsMock = vi.fn();
const fetchAssignableMembersMock = vi.fn();
const fetchTeamSkillsMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../../teams/client/teams-overview-gateway", () => ({
  fetchTeamsOverview: fetchTeamsOverviewMock,
}));

vi.mock("../client/roadmap-gateway", () => ({
  fetchRoadmapItems: fetchRoadmapItemsMock,
  fetchAssignableMembers: fetchAssignableMembersMock,
}));

vi.mock("../../skill-trees/client/skill-trees-gateway", () => ({
  fetchTeamSkills: fetchTeamSkillsMock,
}));

// A tiny reactive stand-in for the router: `replace` rewrites the query and notifies subscribers.
const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { search: "" };
  const replace = vi.fn((url: string) => {
    state.search = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    listeners.forEach((listener) => listener());
  });
  const push = vi.fn();
  return {
    state,
    replace,
    push,
    listeners,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/teams/team-1/roadmap",
    useRouter: () => ({ replace: nav.replace, push: nav.push }),
    useSearchParams: () => {
      const search = useSyncExternalStore(nav.subscribe, () => nav.state.search);
      return new URLSearchParams(search);
    },
  };
});

const { RoadmapPage } = await import("./RoadmapPage");

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

function overviewWith(teams: { teamId: string; name: string }[]) {
  return {
    status: "ok",
    teams: teams.map((team) => ({ ...team, relationship: "member" })),
  };
}

function plan(overrides: Partial<RoadmapItemView> = {}): RoadmapItemView {
  return {
    treeId: "tree-1",
    areaName: "Containers",
    targetNodeId: "node-2",
    targetLabel: "Production rollout",
    targetAvailable: true,
    tracking: { state: "tracked", currentNodeId: "node-1" },
    priority: "high",
    status: "active",
    startDate: null,
    targetDate: null,
    owner: null,
    overdue: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-03T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function roadmapOk(items: RoadmapItemView[], extra: { canEdit?: boolean; truncated?: boolean } = {}) {
  return { status: "ok", items, canEdit: extra.canEdit ?? true, truncated: extra.truncated ?? false };
}

const skillsOk = { status: "ok", skills: [], canReportProgress: true };

function signedIn() {
  observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
  fetchTeamsOverviewMock.mockResolvedValue(overviewWith([{ teamId: "team-1", name: "Platform" }]));
}

beforeEach(() => {
  nav.state.search = "";
  nav.replace.mockClear();
  nav.push.mockClear();
  fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([]));
  fetchTeamSkillsMock.mockResolvedValue(skillsOk);
});

afterEach(() => {
  cleanup();
  observeIdTokenMock.mockReset();
  fetchTeamsOverviewMock.mockReset();
  fetchRoadmapItemsMock.mockReset();
  fetchAssignableMembersMock.mockReset();
  fetchTeamSkillsMock.mockReset();
});

describe("RoadmapPage route shell", () => {
  it("shows a loading state before auth resolves and reads nothing", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<RoadmapPage teamId="team-1" />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
    expect(fetchTeamsOverviewMock).not.toHaveBeenCalled();
    expect(fetchRoadmapItemsMock).not.toHaveBeenCalled();
    expect(fetchTeamSkillsMock).not.toHaveBeenCalled();
  });

  it("prompts sign-in when signed out and reads nothing", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<RoadmapPage teamId="team-1" />);

    expect((await screen.findByRole("link", { name: /logg inn/i })).getAttribute("href")).toBe("/sign-in");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(fetchTeamsOverviewMock).not.toHaveBeenCalled();
    expect(fetchRoadmapItemsMock).not.toHaveBeenCalled();
    expect(fetchTeamSkillsMock).not.toHaveBeenCalled();
  });

  it("renders the current team's name as the heading when the overview contains it", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue(
      overviewWith([
        { teamId: "other", name: "Other team" },
        { teamId: "team-1", name: "Platform" },
      ]),
    );

    render(<RoadmapPage teamId="team-1" />);

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Platform"));
    expect(fetchTeamsOverviewMock).toHaveBeenCalledWith("a-token");
  });

  it("shows the generic heading and the full shell when the overview read fails", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue({ status: "read_failed" });

    render(<RoadmapPage teamId="team-1" />);

    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalled());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team");
    expect(screen.getByRole("navigation", { name: "Teamnavigasjon" })).toBeTruthy();
    await screen.findByText(/Ingen planer ennå/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses the generic heading, not a denied state, when the overview lacks the current team", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue(overviewWith([{ teamId: "other", name: "Other team" }]));

    const { container } = render(<RoadmapPage teamId="secret-team-id" />);

    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalled());
    await screen.findByText(/Ingen planer ennå/);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Teamnavigasjon" })).toBeTruthy();
    expect(container.textContent).not.toContain("secret-team-id");
    expect(container.textContent).not.toContain("Other team");
  });

  it("falls back to the generic heading for an empty team name", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchTeamsOverviewMock.mockResolvedValue(overviewWith([{ teamId: "team-1", name: "" }]));

    render(<RoadmapPage teamId="team-1" />);

    await waitFor(() => expect(fetchTeamsOverviewMock).toHaveBeenCalled());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team");
  });

  it("keeps Roadmap current and the Kompetanseområder link", async () => {
    signedIn();

    render(<RoadmapPage teamId="team-1" />);

    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: "Roadmap" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Oversikt" }).hasAttribute("aria-current")).toBe(false);
    expect(screen.getByRole("link", { name: "Åpne Kompetanseområder" }).getAttribute("href")).toBe(
      "/teams/team-1#team-skill-section-heading",
    );
  });
});

describe("RoadmapPage read shell", () => {
  beforeEach(signedIn);

  it("makes exactly one archived-inclusive roadmap read, one skills read and one overview read", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), plan({ treeId: "tree-old", archived: true })]));

    render(<RoadmapPage teamId="team-1" />);

    await screen.findByRole("heading", { name: "Containers" });
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledWith("a-token", "team-1", { includeArchived: true });
    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state while the roadmap read is pending", async () => {
    fetchRoadmapItemsMock.mockReturnValue(new Promise(() => {}));

    render(<RoadmapPage teamId="team-1" />);

    expect((await screen.findByRole("status")).textContent).toMatch(/laster planer/i);
  });

  it("renders the neutral no-access alert with a link back to the team on an authoritative forbidden read", async () => {
    fetchRoadmapItemsMock.mockResolvedValue({ status: "forbidden" });
    fetchTeamSkillsMock.mockResolvedValue({
      status: "ok",
      skills: [{ treeId: "t", name: "Secret area", nodes: [], currentNodeId: null }],
      canReportProgress: true,
    });

    const { container } = render(<RoadmapPage teamId="team-1" />);

    expect((await screen.findByRole("alert")).textContent).toBe("Du har ikke tilgang til denne roadmapen.");
    expect(screen.getByRole("link", { name: "Tilbake til teamet" }).getAttribute("href")).toBe("/teams/team-1");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(container.textContent).not.toContain("Secret area");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Teamnavigasjon" })).toBeTruthy();
  });

  it("shows the normal error state with retry, not no-access, for a non-forbidden read failure", async () => {
    const user = userEvent.setup();
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "read_failed" });
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan()]));

    render(<RoadmapPage teamId="team-1" />);

    expect((await screen.findByRole("alert")).textContent).toBe("Roadmapen kunne ikke lastes.");
    expect(screen.queryByText(/ikke tilgang/i)).toBeNull();
    expect(screen.queryByText(/Ingen planer ennå/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Prøv igjen" }));

    await screen.findByRole("heading", { name: "Containers" });
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock).toHaveBeenLastCalledWith("a-token", "team-1", { includeArchived: true });
  });

  it("replaces the read error with the no-access alert when the retry is authoritatively forbidden", async () => {
    const user = userEvent.setup();
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "read_failed" });
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "forbidden" });

    const { container } = render(<RoadmapPage teamId="team-1" />);

    expect((await screen.findByRole("alert")).textContent).toBe("Roadmapen kunne ikke lastes.");
    await user.click(screen.getByRole("button", { name: "Prøv igjen" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Du har ikke tilgang til denne roadmapen."),
    );
    expect(screen.getByRole("link", { name: "Tilbake til teamet" }).getAttribute("href")).toBe("/teams/team-1");
    expect(screen.queryByText("Roadmapen kunne ikke lastes.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Prøv igjen" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(container.textContent).not.toContain("Containers");
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock).toHaveBeenNthCalledWith(1, "a-token", "team-1", { includeArchived: true });
    expect(fetchRoadmapItemsMock).toHaveBeenNthCalledWith(2, "a-token", "team-1", { includeArchived: true });
    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(1);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("does not infer no-access when the team is absent from the name read", async () => {
    fetchTeamsOverviewMock.mockResolvedValue(overviewWith([{ teamId: "other", name: "Other" }]));
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan()]));

    render(<RoadmapPage teamId="team-1" />);

    await screen.findByRole("heading", { name: "Containers" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Team");
    expect(screen.queryByText(/ikke tilgang/i)).toBeNull();
  });

  it("shows the empty state for a successful read with no plans", async () => {
    render(<RoadmapPage teamId="team-1" />);

    expect((await screen.findByText(/Ingen planer ennå/)).getAttribute("role")).toBe("status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the empty state, not a blank page, when every plan is archived and hidden", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan({ archived: true })]));

    render(<RoadmapPage teamId="team-1" />);

    await screen.findByText(/Alle planer er arkivert/);
    expect(screen.queryByText(/Ingen planer ennå/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Containers" })).toBeNull();
  });

  it("shows a notice when the roadmap read is truncated", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan()], { truncated: true }));

    render(<RoadmapPage teamId="team-1" />);

    expect(await screen.findByText(/kan være ufullstendig/)).toBeTruthy();
  });

  it("groups non-archived plans Pågår, Planlagt, Fullført in order and omits archived plans", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([
        plan({ treeId: "c", areaName: "Done area", status: "completed", completedAt: "2026-03-04T08:00:00.000Z" }),
        plan({ treeId: "p", areaName: "Planned area", status: "planned" }),
        plan({ treeId: "a", areaName: "Active area", status: "active" }),
        plan({ treeId: "x", areaName: "Archived area", archived: true }),
      ]),
    );

    render(<RoadmapPage teamId="team-1" />);

    await screen.findByRole("heading", { name: "Active area" });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Pågår",
      "Planlagt",
      "Fullført (1)",
    ]);
    expect(screen.queryByText("Archived area")).toBeNull();
  });

  it("hides empty groups", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan({ status: "planned" })]));

    render(<RoadmapPage teamId="team-1" />);

    await screen.findByRole("heading", { name: "Containers" });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Planlagt"]);
  });

  it("renders plan facts as text with labelled dates and handles nullable fields", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([
        plan({
          startDate: "2026-04-01",
          targetDate: "2026-06-30",
          overdue: true,
          targetReached: true,
          tracking: { state: "not_tracked" },
          owner: { state: "unavailable" },
        }),
        plan({
          treeId: "u",
          areaName: null,
          targetAvailable: false,
          targetLabel: null,
          priority: "low",
          status: "planned",
        }),
      ]),
    );

    render(<RoadmapPage teamId="team-1" />);

    const first = (await screen.findByRole("heading", { name: "Containers" })).closest("article") as HTMLElement;
    const text = first.textContent ?? "";
    expect(text).toContain("Startdato: 01.04.2026");
    expect(text).toContain("Måldato: 30.06.2026");
    expect(text).toContain("Production rollout");
    expect(text).toContain("Høy");
    expect(text).toContain("Pågår");
    expect(text).toContain("Måldato passert");
    expect(text).toContain("Målet er nådd");
    expect(text).toContain("Følges ikke");
    expect(text).toContain("Ansvarlig er ikke lenger tilgjengelig");
    expect(text).toContain("Sist oppdatert 03.02.2026");
    expect(first.querySelector('time[datetime="2026-04-01"]')).toBeTruthy();

    const unknown = screen.getByRole("heading", { name: "Ukjent område" }).closest("article") as HTMLElement;
    expect(unknown.textContent).toContain("Målstadiet er ikke tilgjengelig");
    expect(unknown.textContent).toContain("Periode: Ikke satt");
    expect(unknown.textContent).toContain("Ikke tildelt");
  });

  it("shows Fullført <date> only when completedAt is non-null and never 'null'", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([
        plan({ treeId: "dated", areaName: "Dated", status: "completed", completedAt: "2026-03-04T08:00:00.000Z" }),
        plan({ treeId: "legacy", areaName: "Legacy", status: "completed", completedAt: null }),
      ]),
    );

    const { container } = render(<RoadmapPage teamId="team-1" />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Fullført (2)" }));
    const dated = (await screen.findByRole("heading", { name: "Dated" })).closest("article") as HTMLElement;
    const legacy = screen.getByRole("heading", { name: "Legacy" }).closest("article") as HTMLElement;
    expect(dated.textContent).toContain("Fullført 04.03.2026");
    expect(legacy.textContent).not.toMatch(/Fullført\s*\d/);
    expect(legacy.textContent).toContain("Fullført"); // the status field still reads as completed
    expect(container.textContent).not.toContain("null");
    expect(screen.getByRole("heading", { level: 2, name: "Fullført (2)" })).toBeTruthy();
  });

  it("keeps plans and offers a skills-only retry when only the skills read fails", async () => {
    const user = userEvent.setup();
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan()], { canEdit: true }));
    fetchTeamSkillsMock.mockResolvedValueOnce({ status: "read_failed" });
    fetchTeamSkillsMock.mockResolvedValueOnce(skillsOk);

    render(<RoadmapPage teamId="team-1" />);

    await screen.findByRole("heading", { name: "Containers" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Planleggingsdata kunne ikke lastes/);
    expect(screen.queryByText(/Ingen planer ennå/)).toBeNull();
    expect(queryMutationControls()).toEqual([]);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Last planleggingsdata på nytt" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Containers" })).toBeTruthy();
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("shows a scoped loading indicator while skills load, with plans already rendered", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan()]));
    fetchTeamSkillsMock.mockReturnValue(new Promise(() => {}));

    render(<RoadmapPage teamId="team-1" />);

    await screen.findByRole("heading", { name: "Containers" });
    expect(screen.getByText("Laster planleggingsdata…")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders no mutation control for a tracked plan whose area is not in the skills read (no inferred stages)", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan()], { canEdit: true }));

    render(<RoadmapPage teamId="team-1" />);

    await screen.findByRole("heading", { name: "Containers" });
    expect(queryMutationControls()).toEqual([]);
  });

  it("does not render owner identifiers", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([
        plan({
          owner: { state: "current", memberRef: "member-ref-secret", displayName: "Alex", ordinal: 2, isSelf: false },
        }),
      ]),
    );

    const { container } = render(<RoadmapPage teamId="team-1" />);

    await screen.findByText(/Alex \(2\)/);
    expect(container.innerHTML).not.toContain("member-ref-secret");
  });
});

describe("RoadmapPage filters, summary, disclosure and archived visibility (TASK-007)", () => {
  beforeEach(signedIn);

  const dataset = () => [
    plan({ treeId: "a-high", areaName: "Active high", status: "active", priority: "high", overdue: true }),
    plan({ treeId: "a-low", areaName: "Active low", status: "active", priority: "low" }),
    plan({ treeId: "p-high", areaName: "Planned high", status: "planned", priority: "high" }),
    plan({
      treeId: "c-high",
      areaName: "Done high",
      status: "completed",
      priority: "high",
      completedAt: "2026-03-04T08:00:00.000Z",
    }),
    plan({ treeId: "c-legacy", areaName: "Done legacy", status: "completed", priority: "low", completedAt: null }),
    plan({ treeId: "x-done", areaName: "Old done high", status: "completed", priority: "high", archived: true }),
    plan({ treeId: "x-low", areaName: "Old active low", status: "active", priority: "low", archived: true }),
  ];

  const summaryText = () => screen.getByText(/^Planer:/).textContent;
  const names = () => screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  const statusSelect = () => screen.getByLabelText("Status") as HTMLSelectElement;
  const prioritySelect = () => screen.getByLabelText("Prioritet") as HTMLSelectElement;
  const archivedBox = () => screen.getByRole("checkbox", { name: "Vis arkiverte" }) as HTMLInputElement;

  async function renderLoaded(items = dataset()) {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(items));
    const user = userEvent.setup();
    render(<RoadmapPage teamId="team-1" />);
    await screen.findByLabelText("Status");
    return user;
  }

  it("starts with Alle / Alle / archived hidden and no completed or archived plans visible", async () => {
    await renderLoaded();

    expect(statusSelect().value).toBe("all");
    expect(prioritySelect().value).toBe("all");
    expect(archivedBox().checked).toBe(false);
    expect(names()).toEqual(["Active high", "Active low", "Planned high"]);
  });

  it("offers exactly the approved status and priority options", async () => {
    await renderLoaded();

    expect(Array.from(statusSelect().options).map((o) => o.textContent)).toEqual([
      "Alle",
      "Pågår",
      "Planlagt",
      "Fullført",
    ]);
    expect(Array.from(prioritySelect().options).map((o) => o.textContent)).toEqual([
      "Alle",
      "Høy",
      "Middels",
      "Lav",
    ]);
  });

  it("filters by status, by priority, and combines both with AND, with zero extra reads", async () => {
    const user = await renderLoaded();

    await user.selectOptions(statusSelect(), "active");
    expect(names()).toEqual(["Active high", "Active low"]);

    await user.selectOptions(statusSelect(), "all");
    await user.selectOptions(prioritySelect(), "high");
    expect(names()).toEqual(["Active high", "Planned high"]);

    await user.selectOptions(statusSelect(), "planned");
    expect(names()).toEqual(["Planned high"]);

    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(1);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("shows archived plans in a final separate section with zero reads, each plan once", async () => {
    const user = await renderLoaded();

    await user.click(archivedBox());

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Pågår",
      "Planlagt",
      "Fullført (2)",
      "Arkiverte",
    ]);
    const archivedSection = screen
      .getByRole("heading", { level: 2, name: "Arkiverte" })
      .closest("section") as HTMLElement;
    expect(Array.from(archivedSection.querySelectorAll("h3")).map((h) => h.textContent)).toEqual([
      "Old active low",
      "Old done high",
    ]);
    // Archived plans never join a status group, even completed+archived ones: each plan appears once.
    await user.click(screen.getByRole("button", { name: "Fullført (2)" }));
    const all = names();
    expect(all.filter((n) => n === "Old done high")).toHaveLength(1);
    expect(all.filter((n) => n === "Old active low")).toHaveLength(1);
    expect(all).toHaveLength(7);

    await user.click(archivedBox());
    expect(screen.queryByRole("heading", { name: "Arkiverte" })).toBeNull();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("applies status and priority to archived plans once they are shown", async () => {
    const user = await renderLoaded();
    await user.click(archivedBox());

    await user.selectOptions(statusSelect(), "completed");
    await user.selectOptions(prioritySelect(), "high");
    expect(names()).toEqual(["Done high", "Old done high"]);

    await user.selectOptions(statusSelect(), "active");
    await user.selectOptions(prioritySelect(), "low");
    expect(names()).toEqual(["Active low", "Old active low"]);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the plan-count line on the unfiltered non-archived set while filters and archived visibility change", async () => {
    const user = await renderLoaded();
    const before = "Planer: 2 pågår · 1 planlagt · 2 fullført · 1 forfalt av pågår og planlagt";
    expect(summaryText()).toBe(before);

    await user.selectOptions(statusSelect(), "planned");
    expect(summaryText()).toBe(before);
    await user.selectOptions(prioritySelect(), "low");
    expect(summaryText()).toBe(before);
    await user.click(archivedBox());
    expect(summaryText()).toBe(before);
    expect(screen.queryByText(/%|poeng/i)).toBeNull();
  });

  it("omits the overdue part when nothing is overdue", async () => {
    await renderLoaded([plan({ treeId: "a" }), plan({ treeId: "p", status: "planned" })]);

    expect(summaryText()).toBe("Planer: 1 pågår · 1 planlagt · 0 fullført");
  });

  it("keeps Fullført collapsed with aria wiring, expands and collapses it, and tolerates legacy completedAt null", async () => {
    const user = await renderLoaded();
    const trigger = screen.getByRole("button", { name: "Fullført (2)" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const region = document.getElementById(trigger.getAttribute("aria-controls") as string) as HTMLElement;
    expect(region).toBeTruthy();
    expect(region.hidden).toBe(true);
    expect(screen.queryByText("Done high")).toBeNull();

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(region.hidden).toBe(false);
    expect(region.contains(screen.getByText("Done high"))).toBe(true);
    const legacy = screen.getByRole("heading", { name: "Done legacy" }).closest("article") as HTMLElement;
    expect(legacy.textContent).not.toMatch(/Fullført\s*\d/);
    expect(region.textContent).not.toContain("null");

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(region.hidden).toBe(true);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("shows the filtered completed count in the disclosure header while the summary keeps the full count", async () => {
    const user = await renderLoaded();

    await user.selectOptions(prioritySelect(), "high");

    expect(screen.getByRole("button", { name: "Fullført (1)" })).toBeTruthy();
    expect(summaryText()).toContain("2 fullført");
  });

  it("auto-expands Fullført when the status filter becomes Fullført, and the user may collapse it again", async () => {
    const user = await renderLoaded();

    await user.selectOptions(statusSelect(), "completed");

    const trigger = screen.getByRole("button", { name: "Fullført (2)" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(names()).toEqual(["Done high", "Done legacy"]);

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("shows a distinct ingen-treff state whose clear action restores plans without a refetch", async () => {
    const user = await renderLoaded([
      plan({ treeId: "a", areaName: "Only active", status: "active", priority: "high" }),
    ]);

    await user.selectOptions(statusSelect(), "planned");

    expect(screen.getByText(/Ingen treff/)).toBeTruthy();
    expect(screen.queryByText(/Ingen planer ennå/)).toBeNull();
    expect(screen.queryByText(/Alle planer er arkivert/)).toBeNull();
    expect(summaryText()).toBe("Planer: 1 pågår · 0 planlagt · 0 fullført");

    await user.click(screen.getByRole("button", { name: "Fjern filtre" }));

    expect(statusSelect().value).toBe("all");
    expect(names()).toEqual(["Only active"]);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("reveals archived plans immediately from an all-archived dataset without a refetch", async () => {
    const user = await renderLoaded([plan({ treeId: "x", areaName: "Old plan", archived: true })]);

    expect(screen.getByText(/Alle planer er arkivert/)).toBeTruthy();
    expect(screen.queryByText(/^Planer:/)).toBeNull();

    await user.click(archivedBox());

    expect(names()).toEqual(["Old plan"]);
    expect(screen.queryByText(/Alle planer er arkivert/)).toBeNull();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps filters and archived visibility usable under a skills failure, with no extra reads and no mutation controls", async () => {
    fetchTeamSkillsMock.mockResolvedValue({ status: "read_failed" });
    const user = await renderLoaded();
    await screen.findByText(/Planleggingsdata kunne ikke lastes/);

    await user.click(archivedBox());
    expect(screen.getByRole("heading", { name: "Old active low" })).toBeTruthy();
    await user.selectOptions(statusSelect(), "active");
    expect(names()).toEqual(["Active high", "Active low", "Old active low"]);

    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(1);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
    expect(queryMutationControls()).toEqual([]);
  });

  it("shows no filters or counts over a forbidden or failed roadmap read", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "forbidden" });
    const { unmount } = render(<RoadmapPage teamId="team-1" />);
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Status")).toBeNull();
    unmount();

    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "read_failed" });
    render(<RoadmapPage teamId="team-1" />);
    await screen.findByText("Roadmapen kunne ikke lastes.");
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.queryByText(/^Planer:/)).toBeNull();
  });

  it("keeps the truncation notice alongside the filters", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(dataset(), { truncated: true }));
    render(<RoadmapPage teamId="team-1" />);

    expect(await screen.findByText(/kan være ufullstendig/)).toBeTruthy();
    expect(screen.getByLabelText("Status")).toBeTruthy();
  });

  it("does not persist filters or disclosure state in the URL or localStorage, and resets on remount", async () => {
    const user = await renderLoaded();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const url = window.location.href;

    await user.selectOptions(statusSelect(), "completed");
    await user.click(archivedBox());

    expect(setItem).not.toHaveBeenCalled();
    expect(window.location.href).toBe(url);
    cleanup();
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(dataset()));
    render(<RoadmapPage teamId="team-1" />);
    await screen.findByLabelText("Status");
    expect(statusSelect().value).toBe("all");
    expect(archivedBox().checked).toBe(false);
    expect(screen.getByRole("button", { name: "Fullført (2)" }).getAttribute("aria-expanded")).toBe("false");
    setItem.mockRestore();
  });
});

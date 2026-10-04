// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

function roadmapOk(items: RoadmapItemView[]) {
  return { status: "ok", items, canEdit: true, truncated: false };
}

beforeEach(() => {
  nav.state.search = "";
  nav.replace.mockClear();
  nav.push.mockClear();
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchTeamsOverviewMock.mockResolvedValue({
    status: "ok",
    teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }],
  });
  fetchTeamSkillsMock.mockResolvedValue({ status: "ok", skills: [], canReportProgress: true });
});

afterEach(() => {
  cleanup();
  observeIdTokenMock.mockReset();
  fetchTeamsOverviewMock.mockReset();
  fetchRoadmapItemsMock.mockReset();
  fetchAssignableMembersMock.mockReset();
  fetchTeamSkillsMock.mockReset();
});

const dataset = () => [
  plan({ treeId: "over", areaName: "Overdue plan", overdue: true, targetDate: "2026-03-01" }),
  plan({ treeId: "q4", areaName: "Q4 plan", status: "planned", targetDate: "2026-11-15", priority: "low" }),
  plan({ treeId: "q2", areaName: "Q2 plan", status: "planned", targetDate: "2026-05-10", startDate: "2026-01-05" }),
  plan({ treeId: "start", areaName: "Start only", status: "planned", startDate: "2026-09-01" }),
  plan({ treeId: "none", areaName: "Undated plan", status: "planned" }),
  plan({
    treeId: "done",
    areaName: "Done dated",
    status: "completed",
    targetDate: "2026-05-01",
    completedAt: "2026-03-04T08:00:00.000Z",
  }),
  plan({ treeId: "legacy", areaName: "Done legacy", status: "completed", completedAt: null }),
  plan({ treeId: "xdone", areaName: "Old done", status: "completed", archived: true, targetDate: "2026-05-02" }),
  plan({ treeId: "xact", areaName: "Old active", archived: true, overdue: true, priority: "low" }),
];

const statusSelect = () => screen.getByLabelText("Status") as HTMLSelectElement;
const prioritySelect = () => screen.getByLabelText("Prioritet") as HTMLSelectElement;
const archivedBox = () => screen.getByRole("checkbox", { name: "Vis arkiverte" }) as HTMLInputElement;
const listButton = () => screen.getByRole("button", { name: "Liste" });
const timelineButton = () => screen.getByRole("button", { name: "Tidslinje" });
const summaryText = () => screen.getByText(/^Planer:/).textContent;
const names = () => screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent);
const groupHeadings = () => screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const LIST_HEADINGS = ["Pågår", "Planlagt", "Fullført (2)"];

function groupNames(heading: string): string[] {
  const section = screen.getByRole("heading", { level: 2, name: heading }).closest("section") as HTMLElement;
  return Array.from(section.querySelectorAll("h3")).map((h) => h.textContent ?? "");
}

async function renderLoaded(options: { search?: string; items?: RoadmapItemView[] } = {}) {
  nav.state.search = options.search ?? "";
  fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(options.items ?? dataset()));
  const user = userEvent.setup();
  render(<RoadmapPage teamId="team-1" />);
  await screen.findByLabelText("Status");
  return user;
}

describe("view selection", () => {
  it("shows the list by default with Liste pressed", async () => {
    await renderLoaded();

    expect(listButton().getAttribute("aria-pressed")).toBe("true");
    expect(timelineButton().getAttribute("aria-pressed")).toBe("false");
    expect(groupHeadings()).toEqual(LIST_HEADINGS);
    expect(screen.getByRole("group", { name: "Visning" })).toBeTruthy();
  });

  it("shows the timeline for ?view=timeline", async () => {
    await renderLoaded({ search: "view=timeline" });

    expect(timelineButton().getAttribute("aria-pressed")).toBe("true");
    expect(listButton().getAttribute("aria-pressed")).toBe("false");
    expect(groupHeadings()).toContain("Forfalt");
  });

  it.each(["foo", "", "Timeline", "list", "timeline,list"])(
    "falls back to the list for ?view=%s without rewriting the URL",
    async (value) => {
      await renderLoaded({ search: `view=${value}` });

      expect(listButton().getAttribute("aria-pressed")).toBe("true");
      expect(groupHeadings()).toEqual(LIST_HEADINGS);
      expect(nav.replace).not.toHaveBeenCalled();
    },
  );

  it("switches list → timeline → list by replacing the URL, keeping unrelated parameters", async () => {
    const user = await renderLoaded({ search: "ref=abc&view=foo" });

    await user.click(timelineButton());
    expect(nav.replace).toHaveBeenLastCalledWith("/teams/team-1/roadmap?ref=abc&view=timeline", { scroll: false });
    expect(timelineButton().getAttribute("aria-pressed")).toBe("true");
    expect(groupHeadings()).toContain("Forfalt");

    await user.click(listButton());
    expect(nav.replace).toHaveBeenLastCalledWith("/teams/team-1/roadmap?ref=abc", { scroll: false });
    expect(listButton().getAttribute("aria-pressed")).toBe("true");
    expect(groupHeadings()).toEqual(LIST_HEADINGS);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("drops the query entirely when returning to the list with no other parameters", async () => {
    const user = await renderLoaded({ search: "view=timeline" });

    await user.click(listButton());

    expect(nav.replace).toHaveBeenLastCalledWith("/teams/team-1/roadmap", { scroll: false });
  });

  it("does not store the view in localStorage and makes no extra reads when switching", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const user = await renderLoaded();

    await user.click(timelineButton());
    await user.click(listButton());
    await user.click(timelineButton());

    expect(setItem).not.toHaveBeenCalled();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamsOverviewMock).toHaveBeenCalledTimes(1);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe("timeline partition and order", () => {
  it("groups by first-match precedence in the fixed group order, with each visible plan exactly once", async () => {
    const user = await renderLoaded({ search: "view=timeline" });
    await user.click(archivedBox());
    await user.click(screen.getByRole("button", { name: "Fullførte (2)" }));

    expect(groupHeadings()).toEqual([
      "Forfalt",
      "2. kvartal 2026",
      "4. kvartal 2026",
      "Kun startdato",
      "Uten dato",
      "Fullførte (2)",
      "Arkiverte",
    ]);
    expect(groupNames("Forfalt")).toEqual(["Overdue plan"]);
    expect(groupNames("2. kvartal 2026")).toEqual(["Q2 plan"]);
    expect(groupNames("4. kvartal 2026")).toEqual(["Q4 plan"]);
    expect(groupNames("Kun startdato")).toEqual(["Start only"]);
    expect(groupNames("Uten dato")).toEqual(["Undated plan"]);
    // completed + target date stays in Fullførte (dated first, legacy null last)
    expect(groupNames("Fullførte (2)")).toEqual(["Done dated", "Done legacy"]);
    // archived + completed and archived + overdue appear only in Arkiverte
    expect(groupNames("Arkiverte")).toEqual(["Old active", "Old done"]);

    const all = names();
    expect(all).toHaveLength(9);
    expect(new Set(all).size).toBe(9);
  });

  it("renders groups as headings with ordered lists and no Nå marker or chart", async () => {
    await renderLoaded({ search: "view=timeline" });

    const section = screen.getByRole("heading", { level: 2, name: "Forfalt" }).closest("section") as HTMLElement;
    expect(section.querySelector("ol > li")).toBeTruthy();
    expect(screen.queryByText(/^Nå$/)).toBeNull();
    expect(document.body.querySelector('[role="progressbar"], svg')).toBeNull();
  });

  it("omits empty groups and keeps Fullførte items hidden until expanded", async () => {
    await renderLoaded({ search: "view=timeline" });

    expect(groupHeadings()).toEqual([
      "Forfalt",
      "2. kvartal 2026",
      "4. kvartal 2026",
      "Kun startdato",
      "Uten dato",
      "Fullførte (2)",
    ]);
    expect(names()).not.toContain("Done dated");
    expect(screen.queryByRole("heading", { name: "Arkiverte" })).toBeNull();
  });

  it("orders quarters ascending and plans inside a quarter by target date", async () => {
    await renderLoaded({
      search: "view=timeline",
      items: [
        plan({ treeId: "next", areaName: "Next year", status: "planned", targetDate: "2027-01-10" }),
        plan({ treeId: "late", areaName: "Late", status: "planned", targetDate: "2026-06-20" }),
        plan({ treeId: "early", areaName: "Early", status: "planned", targetDate: "2026-04-02" }),
      ],
    });

    expect(groupHeadings()).toEqual(["2. kvartal 2026", "1. kvartal 2027"]);
    expect(groupNames("2. kvartal 2026")).toEqual(["Early", "Late"]);
  });

  it("uses the server overdue flag, not the clock, and invents no dates", async () => {
    await renderLoaded({
      search: "view=timeline",
      items: [
        plan({ treeId: "past", areaName: "Past but not flagged", status: "planned", targetDate: "2021-01-01" }),
        plan({ treeId: "flag", areaName: "Flagged", overdue: true, targetDate: "2099-01-01" }),
        plan({ treeId: "u", areaName: "Undated", status: "planned" }),
      ],
    });

    expect(groupNames("Forfalt")).toEqual(["Flagged"]);
    expect(groupNames("1. kvartal 2021")).toEqual(["Past but not flagged"]);
    const undated = screen.getByRole("heading", { name: "Undated" }).closest("article") as HTMLElement;
    expect(undated.textContent).toContain("Periode: Ikke satt");
  });

  it("keeps the card facts as text in timeline rows", async () => {
    await renderLoaded({ search: "view=timeline" });

    const row = screen.getByRole("heading", { name: "Overdue plan" }).closest("article") as HTMLElement;
    expect(row.textContent).toContain("Måldato: 01.03.2026");
    expect(row.textContent).toContain("Måldato passert");
    expect(row.textContent).toContain("Pågår");
    expect(row.textContent).toContain("Høy");
  });
});

describe("state shared across views", () => {
  it("keeps status, priority, archived visibility and completed expansion when switching views", async () => {
    const user = await renderLoaded();
    await user.selectOptions(statusSelect(), "completed");
    await user.click(archivedBox());
    await user.selectOptions(prioritySelect(), "high");

    await user.click(timelineButton());
    expect(statusSelect().value).toBe("completed");
    expect(prioritySelect().value).toBe("high");
    expect(archivedBox().checked).toBe(true);
    expect(groupHeadings()).toEqual(["Fullførte (2)", "Arkiverte"]);
    expect(screen.getByRole("button", { name: "Fullførte (2)" }).getAttribute("aria-expanded")).toBe("true");
    expect(names()).toEqual(["Done dated", "Done legacy", "Old done"]);

    await user.click(listButton());
    expect(statusSelect().value).toBe("completed");
    expect(prioritySelect().value).toBe("high");
    expect(archivedBox().checked).toBe(true);
    expect(screen.getByRole("button", { name: "Fullført (2)" }).getAttribute("aria-expanded")).toBe("true");
    expect(names()).toEqual(["Done dated", "Done legacy", "Old done"]);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("shares a collapsed or expanded completed disclosure across views in both directions", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Fullført (2)" }));
    await user.click(timelineButton());

    const trigger = screen.getByRole("button", { name: "Fullførte (2)" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(listButton());
    expect(screen.getByRole("button", { name: "Fullført (2)" }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("completed disclosure in the timeline", () => {
  it("is collapsed by default with aria wiring, expands, collapses, and tolerates legacy completedAt null", async () => {
    const user = await renderLoaded({ search: "view=timeline" });
    const trigger = screen.getByRole("button", { name: "Fullførte (2)" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const region = document.getElementById(trigger.getAttribute("aria-controls") as string) as HTMLElement;
    expect(region.hidden).toBe(true);
    expect(screen.queryByText("Done legacy")).toBeNull();

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const legacy = screen.getByRole("heading", { name: "Done legacy" }).closest("article") as HTMLElement;
    expect(legacy.textContent).not.toMatch(/Fullført\s*\d/);
    expect(region.textContent).not.toContain("null");
    expect(region.contains(screen.getByRole("heading", { name: "Done dated" }))).toBe(true);

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("auto-expands when the status filter becomes Fullført, and the user may collapse it again", async () => {
    const user = await renderLoaded({ search: "view=timeline" });

    await user.selectOptions(statusSelect(), "completed");
    const trigger = screen.getByRole("button", { name: "Fullførte (2)" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(names()).toEqual(["Done dated", "Done legacy"]);

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });
});

describe("filters and summary in the timeline", () => {
  it("applies status, priority and AND semantics with zero extra reads", async () => {
    const user = await renderLoaded({ search: "view=timeline" });

    await user.selectOptions(statusSelect(), "planned");
    expect(names()).toEqual(["Q2 plan", "Q4 plan", "Start only", "Undated plan"]);

    await user.selectOptions(statusSelect(), "all");
    await user.selectOptions(prioritySelect(), "low");
    expect(names()).toEqual(["Q4 plan"]);

    await user.selectOptions(statusSelect(), "planned");
    expect(groupHeadings()).toEqual(["4. kvartal 2026"]);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(1);
  });

  it("shows Arkiverte only with Vis arkiverte, still subject to status and priority", async () => {
    const user = await renderLoaded({ search: "view=timeline" });
    expect(screen.queryByRole("heading", { name: "Arkiverte" })).toBeNull();

    await user.click(archivedBox());
    expect(groupNames("Arkiverte")).toEqual(["Old active", "Old done"]);

    await user.selectOptions(prioritySelect(), "low");
    expect(groupNames("Arkiverte")).toEqual(["Old active"]);
    await user.selectOptions(statusSelect(), "completed");
    expect(screen.queryByRole("heading", { name: "Arkiverte" })).toBeNull();

    await user.click(archivedBox());
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the summary on the canonical non-archived set in both views", async () => {
    const user = await renderLoaded();
    const before = "Planer: 1 pågår · 4 planlagt · 2 fullført · 1 forfalt av pågår og planlagt";
    expect(summaryText()).toBe(before);

    await user.click(timelineButton());
    expect(summaryText()).toBe(before);
    await user.selectOptions(statusSelect(), "planned");
    await user.click(archivedBox());
    expect(summaryText()).toBe(before);
  });
});

describe("empty and error states", () => {
  it("shows the filtered-empty state, not empty groups, in the timeline", async () => {
    const user = await renderLoaded({ search: "view=timeline", items: [plan({ treeId: "a" })] });

    await user.selectOptions(statusSelect(), "planned");

    expect(screen.getByText(/Ingen treff/)).toBeTruthy();
    expect(groupHeadings()).toEqual([]);
    expect(timelineButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the all-archived hint and reveals Arkiverte without a refetch", async () => {
    const user = await renderLoaded({
      search: "view=timeline",
      items: [plan({ treeId: "x", areaName: "Old plan", archived: true })],
    });

    expect(screen.getByText(/Alle planer er arkivert/)).toBeTruthy();
    await user.click(archivedBox());

    expect(groupHeadings()).toEqual(["Arkiverte"]);
    expect(names()).toEqual(["Old plan"]);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("shows no view switch for zero plans", async () => {
    nav.state.search = "view=timeline";
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([]));
    render(<RoadmapPage teamId="team-1" />);

    await screen.findByText(/Ingen planer ennå/);
    expect(screen.queryByRole("group", { name: "Visning" })).toBeNull();
  });

  it("keeps the timeline, view switch and disclosure usable under a skills failure", async () => {
    fetchTeamSkillsMock.mockResolvedValue({ status: "read_failed" });
    const user = await renderLoaded({ search: "view=timeline" });
    await screen.findByText(/Planleggingsdata kunne ikke lastes/);

    await user.click(listButton());
    await user.click(timelineButton());
    await user.click(screen.getByRole("button", { name: "Fullførte (2)" }));

    expect(screen.getByRole("heading", { name: "Done dated" })).toBeTruthy();
    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(1);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(queryMutationControls()).toEqual([]);
  });

  it("shows no view switch or timeline over a forbidden or failed roadmap read", async () => {
    nav.state.search = "view=timeline";
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "forbidden" });
    const { unmount } = render(<RoadmapPage teamId="team-1" />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Tidslinje" })).toBeNull();
    unmount();

    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "read_failed" });
    render(<RoadmapPage teamId="team-1" />);
    await screen.findByText("Roadmapen kunne ikke lastes.");
    expect(screen.queryByRole("button", { name: "Tidslinje" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Visning" })).toBeNull();
  });
});

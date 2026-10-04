// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoadmapItemView } from "../server/list-roadmap-items";
import { queryMutationControls } from "./roadmap-test-helpers";

const observeIdTokenMock = vi.fn();
const fetchTeamsOverviewMock = vi.fn();
const fetchRoadmapItemsMock = vi.fn();
const fetchAssignableMembersMock = vi.fn();
const fetchTeamSkillsMock = vi.fn();
const updateRoadmapItemMock = vi.fn();
const createRoadmapItemMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../../teams/client/teams-overview-gateway", () => ({ fetchTeamsOverview: fetchTeamsOverviewMock }));
vi.mock("../client/roadmap-gateway", () => ({
  fetchRoadmapItems: fetchRoadmapItemsMock,
  fetchAssignableMembers: fetchAssignableMembersMock,
  updateRoadmapItem: updateRoadmapItemMock,
  createRoadmapItem: createRoadmapItemMock,
}));
vi.mock("../../skill-trees/client/skill-trees-gateway", () => ({ fetchTeamSkills: fetchTeamSkillsMock }));

const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { search: "" };
  const replace = vi.fn((url: string) => {
    state.search = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    listeners.forEach((listener) => listener());
  });
  return {
    state,
    replace,
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
    useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
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

const NODES = [
  { nodeId: "node-1", label: "Grunnleggende", order: 1 },
  { nodeId: "node-2", label: "Production rollout", order: 2 },
  { nodeId: "node-3", label: "Ekspert", order: 3 },
];

// Editor labels use the skills-read name (the DTO name only titles the card).
const AREA_NAMES: Record<string, string> = { "tree-1": "Containers", "tree-2": "Second", "tree-3": "Third" };

function skillsFor(...treeIds: string[]) {
  return {
    status: "ok",
    skills: treeIds.map((treeId) => ({ treeId, name: AREA_NAMES[treeId] ?? treeId, nodes: NODES, currentNodeId: "node-1" })),
    canReportProgress: true,
  };
}

function roadmapOk(items: RoadmapItemView[], canEdit = true) {
  return { status: "ok", items, canEdit, truncated: false };
}

const MEMBERS = {
  status: "ok",
  members: [{ memberRef: "ref-alex-secret", displayName: "Alex", ordinal: 1, isSelf: false }],
  unavailableCount: 0,
  truncated: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  nav.state.search = "";
  nav.replace.mockClear();
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchTeamsOverviewMock.mockResolvedValue({ status: "ok", teams: [{ teamId: "team-1", name: "Platform", relationship: "member" }] });
  fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1", "tree-2", "tree-3"));
  fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
  fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan()]));
});

afterEach(() => {
  cleanup();
  for (const mock of [
    observeIdTokenMock,
    fetchTeamsOverviewMock,
    fetchRoadmapItemsMock,
    fetchAssignableMembersMock,
    fetchTeamSkillsMock,
    updateRoadmapItemMock,
    createRoadmapItemMock,
  ]) {
    mock.mockReset();
  }
});

async function renderPage(findHeading = "Containers") {
  const user = userEvent.setup();
  const view = render(<RoadmapPage teamId="team-1" />);
  await screen.findByRole("heading", { name: findHeading });
  return { user, ...view };
}

async function openEditor(user: ReturnType<typeof userEvent.setup>, area = "Containers") {
  await user.click(await screen.findByRole("button", { name: `Rediger plan – ${area}` }));
  return screen.getByRole("form", { name: `Rediger plan – ${area}` });
}

describe("Roadmap page editing — capability boundary", () => {
  it("exposes no mutation control when canEdit is false (read-only member or admin)", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Old", archived: true })], false));
    const { user } = await renderPage();
    await user.click(screen.getByRole("checkbox", { name: "Vis arkiverte" }));
    expect(screen.getByRole("heading", { name: "Old" })).toBeTruthy();
    expect(queryMutationControls()).toEqual([]);
  });

  it("exposes no mutation control while skills load, and no owner read", async () => {
    fetchTeamSkillsMock.mockReturnValue(new Promise(() => {}));
    await renderPage();
    expect(queryMutationControls()).toEqual([]);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("offers controls on an eligible plan only after skills load, without a roadmap refetch or owner read", async () => {
    fetchTeamSkillsMock.mockResolvedValueOnce({ status: "read_failed" }).mockResolvedValueOnce(skillsFor("tree-1"));
    const { user } = await renderPage();
    await screen.findByText(/Planleggingsdata kunne ikke lastes/);
    expect(queryMutationControls()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Last planleggingsdata på nytt" }));

    expect(await screen.findByRole("button", { name: "Rediger plan – Containers" })).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("keeps a tracked plan read-only when its area is missing from the skills read", async () => {
    fetchTeamSkillsMock.mockResolvedValue(skillsFor("some-other-tree"));
    await renderPage();
    // The only mutation control is creation for the uncovered skills area (TASK-010); the plan has none.
    expect(queryMutationControls().map((control) => control.getAttribute("aria-label"))).toEqual([
      "Planlegg – some-other-tree",
    ]);
    expect(screen.queryByRole("button", { name: /Containers/ })).toBeNull();
  });
});

describe("Roadmap page editing — legacy completed plans (BR-23a)", () => {
  const legacy = () => plan({ treeId: "tree-2", areaName: "Legacy", status: "completed", completedAt: null });
  const normalDone = () =>
    plan({ treeId: "tree-3", areaName: "Normal done", status: "completed", completedAt: "2026-03-01T00:00:00.000Z" });

  async function expandCompleted(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^Fullført(e)? \(\d+\)$/ }));
  }

  it.each([["list", ""], ["timeline", "view=timeline"]])(
    "gives a legacy completed plan no control while a valid completed plan keeps its edit control (%s)",
    async (_name, search) => {
      nav.state.search = search;
      fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([legacy(), normalDone()]));
      const user = userEvent.setup();
      render(<RoadmapPage teamId="team-1" />);
      await screen.findByRole("button", { name: /^Fullført(e)? \(2\)$/ });
      await expandCompleted(user);

      expect(screen.getByRole("button", { name: "Rediger plan – Third" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /– Second/ })).toBeNull();
      expect(screen.getByRole("heading", { name: "Legacy" })).toBeTruthy();
      expect(updateRoadmapItemMock).not.toHaveBeenCalled();
    },
  );

  it("offers restore for an archived valid plan but never for an archived legacy plan, and sends no PATCH", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([
        plan({ treeId: "tree-2", areaName: "Archived legacy", status: "completed", completedAt: null, archived: true }),
        plan({ treeId: "tree-3", areaName: "Archived normal", archived: true }),
        plan(),
      ]),
    );
    const { user } = await renderPage();
    await user.click(screen.getByRole("checkbox", { name: "Vis arkiverte" }));

    expect(screen.getByRole("button", { name: "Gjenopprett plan – Third" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Gjenopprett plan – Second/ })).toBeNull();
    expect(updateRoadmapItemMock).not.toHaveBeenCalled();
  });
});

describe("Roadmap page editing — list/timeline parity and owner loading", () => {
  const dataset = () => [
    plan(),
    plan({ treeId: "tree-2", areaName: "Legacy", status: "completed", completedAt: null }),
    plan({ treeId: "tree-3", areaName: "Gone area", tracking: { state: "tracked", currentNodeId: "node-1" } }),
  ];

  it.each([["list", ""], ["timeline", "view=timeline"]])(
    "shows the edit control on an eligible plan and none on ineligible ones (%s)",
    async (_name, search) => {
      nav.state.search = search;
      fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1"));
      fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(dataset()));
      await renderPage();
      expect(queryMutationControls().map((el) => el.getAttribute("aria-label"))).toEqual(["Rediger plan – Containers"]);
    },
  );

  it("reads owners only when an editor opens: not on load, filtering or view switching; then once", async () => {
    const { user } = await renderPage();
    await user.selectOptions(screen.getByLabelText("Status"), "all");
    await user.click(screen.getByRole("button", { name: "Tidslinje" }));
    await user.click(screen.getByRole("button", { name: "Liste" }));
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();

    const form = await openEditor(user);
    await waitFor(() => expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(1));
    await user.click(within(form).getByRole("button", { name: "Avbryt" }));
    await openEditor(user);
    expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(1);
  });

  it("never shows a member reference while owners are loaded", async () => {
    const { user, container } = await renderPage();
    const form = await openEditor(user);
    await within(form).findByRole("option", { name: /Alex/ });
    expect(container.textContent).not.toContain("ref-alex-secret");
    expect(container.innerHTML).not.toMatch(/data-[a-z-]*ref|aria-[a-z-]*="ref-alex/);
  });

  it("wires the trigger as a disclosure and returns focus to it when the editor closes", async () => {
    const { user } = await renderPage();
    const trigger = screen.getByRole("button", { name: "Rediger plan – Containers" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    const form = await openEditor(user);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(trigger.getAttribute("aria-controls") ?? "")?.contains(form)).toBe(true);

    await user.click(within(form).getByRole("button", { name: "Avbryt" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Roadmap page editing — successful write and canonical refetch", () => {
  it("sends the existing PATCH, changes nothing before the refetch, then renders the refetched data with filters and view intact", async () => {
    const other = plan({ treeId: "tree-2", areaName: "Other", priority: "low" });
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan(), other]));
    const { user } = await renderPage();
    await user.selectOptions(screen.getByLabelText("Prioritet"), "high");
    expect(screen.queryByRole("heading", { name: "Other" })).toBeNull();

    const refetch = deferred<ReturnType<typeof roadmapOk>>();
    fetchRoadmapItemsMock.mockReturnValueOnce(refetch.promise);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });

    const form = await openEditor(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    await waitFor(() => expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2));
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("a-token", "team-1", "tree-1", { priority: "low" });
    // No optimistic update: the old card is still presented, unchanged, until the refetch resolves.
    expect(screen.getByRole("heading", { name: "Containers" })).toBeTruthy();
    expect(screen.getByText("Høy", { selector: "dd" })).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenLastCalledWith("a-token", "team-1", { includeArchived: true });

    refetch.resolve(roadmapOk([plan({ priority: "low" }), other]));

    // The priority filter (high) is unchanged, so the edited plan now correctly drops out.
    await waitFor(() => expect(screen.getByText(/Ingen treff/)).toBeTruthy());
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(1);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("moves a plan into Fullført after completion and keeps the disclosure state and timeline view", async () => {
    nav.state.search = "view=timeline";
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan()]));
    const { user } = await renderPage();
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    fetchRoadmapItemsMock.mockResolvedValueOnce(
      roadmapOk([plan({ status: "completed", completedAt: "2026-04-01T00:00:00.000Z" })]),
    );

    const form = await openEditor(user);
    await user.selectOptions(within(form).getByLabelText("Status"), "completed");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    const disclosure = await screen.findByRole("button", { name: "Fullførte (1)" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Tidslinje" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("heading", { name: "Containers" })).toBeNull();
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("a-token", "team-1", "tree-1", { status: "completed" });
  });

  it("archives through the editor: hidden with Vis arkiverte off, under Arkiverte with it on, no extra GET kind", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Stays" })]));
    const { user } = await renderPage("Stays");
    await user.click(screen.getByRole("checkbox", { name: "Vis arkiverte" }));
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    fetchRoadmapItemsMock.mockResolvedValueOnce(
      roadmapOk([plan({ archived: true }), plan({ treeId: "tree-2", areaName: "Stays" })]),
    );

    const form = await openEditor(user);
    await user.click(within(form).getByRole("button", { name: "Arkiver" }));

    const archivedSection = (await screen.findByRole("heading", { level: 2, name: "Arkiverte" })).closest("section");
    expect(within(archivedSection as HTMLElement).getByRole("heading", { name: "Containers" })).toBeTruthy();
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("a-token", "team-1", "tree-1", { archived: true });
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock.mock.calls.every((call) => call[2]?.includeArchived === true)).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: "Vis arkiverte" }));
    expect(screen.queryByRole("heading", { name: "Containers" })).toBeNull();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
  });

  it("regroups the timeline from the refetched target date rather than local state", async () => {
    nav.state.search = "view=timeline";
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan({ targetDate: "2026-11-15" })]));
    const { user } = await renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "4. kvartal 2026" })).toBeTruthy();
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan({ targetDate: "2027-02-10" })]));

    const form = await openEditor(user);
    await user.clear(within(form).getByLabelText("Måldato"));
    await user.type(within(form).getByLabelText("Måldato"), "2027-02-10");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByRole("heading", { level: 2, name: "1. kvartal 2027" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "4. kvartal 2026" })).toBeNull();
  });
});

describe("Roadmap page editing — failures", () => {
  it("keeps the canonical presentation, shows the editor error and does not refetch on persistence_failed", async () => {
    const { user } = await renderPage();
    updateRoadmapItemMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const form = await openEditor(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByText("Planen ble ikke lagret. Prøv igjen.")).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Høy", { selector: "dd" })).toBeTruthy();
    expect(screen.queryByText(/Lav/, { selector: "dd" })).toBeNull();
  });

  it("reports a failed canonical refetch separately and keeps the previous state", async () => {
    const { user } = await renderPage();
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "read_failed" });

    const form = await openEditor(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByText(/Endringen er lagret, men siste planstatus kunne ikke lastes/)).toBeTruthy();
    expect(screen.getByText("Høy", { selector: "dd" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Last planer på nytt" })).toBeTruthy();
  });

  it("turns the page into the no-access state when the post-write refetch is forbidden", async () => {
    const { user } = await renderPage();
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "forbidden" });

    const form = await openEditor(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Du har ikke tilgang til denne roadmapen.");
    expect(screen.queryByRole("heading", { name: "Containers" })).toBeNull();
    expect(queryMutationControls()).toEqual([]);
  });
});

describe("Roadmap page editing — concurrent writes", () => {
  it("lets the newest canonical refetch win when two writes overlap", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(
      roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second" })]),
    );
    const { user } = await renderPage("Second");
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const older = deferred<ReturnType<typeof roadmapOk>>();
    const newer = deferred<ReturnType<typeof roadmapOk>>();
    fetchRoadmapItemsMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const first = await openEditor(user, "Containers");
    await user.selectOptions(within(first).getByLabelText("Prioritet"), "low");
    await user.click(within(first).getByRole("button", { name: "Lagre" }));
    const second = await openEditor(user, "Second");
    await user.selectOptions(within(second).getByLabelText("Prioritet"), "medium");
    await user.click(within(second).getByRole("button", { name: "Lagre" }));
    await waitFor(() => expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(3));

    const final = roadmapOk([
      plan({ priority: "low" }),
      plan({ treeId: "tree-2", areaName: "Second", priority: "medium" }),
    ]);
    newer.resolve(final);
    await waitFor(() => expect(screen.getAllByText("Lav", { selector: "dd" })).toHaveLength(1));
    older.resolve(roadmapOk([plan({ priority: "low" }), plan({ treeId: "tree-2", areaName: "Second" })]));

    await waitFor(() => expect(screen.queryByRole("button", { name: /Lagrer/ })).toBeNull());
    expect(screen.getByText("Middels", { selector: "dd" })).toBeTruthy();
  });
});

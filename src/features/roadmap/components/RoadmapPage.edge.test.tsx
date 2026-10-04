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

const untracked = (overrides: Partial<RoadmapItemView> = {}) =>
  plan({ treeId: "tree-2", areaName: "Second", tracking: { state: "not_tracked" }, ...overrides });
const archivedPlan = (overrides: Partial<RoadmapItemView> = {}) =>
  plan({ treeId: "tree-2", areaName: "Second", archived: true, ...overrides });
const views = [["list", ""], ["timeline", "view=timeline"]] as const;
const showArchived = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("checkbox", { name: "Vis arkiverte" }));
const cardOf = (name: string) => screen.getByRole("heading", { name }).closest("article") as HTMLElement;

// Waits for the loaded roadmap (the archive toggle exists only once plans exist), whatever is visible.
async function renderReady() {
  const user = userEvent.setup();
  const view = render(<RoadmapPage teamId="team-1" />);
  await screen.findByRole("checkbox", { name: "Vis arkiverte" });
  return { user, ...view };
}

describe("Roadmap page edge states — untracked plans", () => {
  it.each(views)("shows an untracked plan in place with its explanation and an edit control (%s)", async (_n, search) => {
    nav.state.search = search;
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), untracked()]));
    await renderPage();
    const card = cardOf("Second");
    expect(card.textContent).toContain("Følges ikke");
    expect(card.textContent).toContain("Teamet følger ikke lenger dette kompetanseområdet");
    expect(card.textContent).toContain("Production rollout");
    expect(within(card).getByRole("button", { name: "Rediger plan – Second" })).toBeTruthy();
  });

  it("locks the target, keeps other fields editable and never sends a target or restarts tracking", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([untracked()]));
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const { user } = await renderPage("Second");
    const form = await openEditor(user, "Second");

    expect(within(form).getByText(/Målstadiet kan ikke endres/)).toBeTruthy();
    expect(within(form).queryByLabelText("Målstadium")).toBeNull();
    for (const label of ["Prioritet", "Status", "Startdato", "Måldato", "Ansvarlig"]) {
      expect(within(form).getByLabelText(label)).toBeTruthy();
    }

    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    await waitFor(() => expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1));
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("a-token", "team-1", "tree-2", { priority: "low" });
  });

  it("keeps a plan with an unavailable target readable, with the exact fallback and a locked target", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([untracked({ targetAvailable: false, targetLabel: null, targetNodeId: "gone-node" })]),
    );
    const { user, container } = await renderPage("Second");
    expect(cardOf("Second").textContent).toContain("Målstadium: Målstadiet er ikke tilgjengelig");
    const form = await openEditor(user, "Second");
    expect(within(form).queryByLabelText("Målstadium")).toBeNull();
    expect(container.textContent).not.toContain("gone-node");
  });

  it("falls back to 'Ukjent område' for a missing area name without exposing the tree id", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([untracked({ areaName: null, treeId: "tree-secret-id" })]));
    const { container } = await renderPage("Ukjent område");
    expect(container.textContent).not.toContain("tree-secret-id");
  });

  it("keeps an untracked legacy completed plan fully read-only without the editable-fields claim", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([untracked({ status: "completed", completedAt: null })]));
    const { user } = await renderReady();
    await user.click(screen.getByRole("button", { name: /^Fullført(e)? \(1\)$/ }));
    expect(within(cardOf("Second")).queryAllByRole("button")).toEqual([]);
    const card = cardOf("Second");
    expect(card.textContent).toContain("Eldre fullført plan – kan ikke endres");
    expect(card.textContent).not.toContain("kan fortsatt endres");
    expect(updateRoadmapItemMock).not.toHaveBeenCalled();
  });

  it("still blocks creation for the untracked plan's area while another uncovered area stays creatable", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), untracked()]));
    fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1", "tree-3"));
    await renderPage();
    expect(await screen.findByRole("button", { name: "Planlegg – Third" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Planlegg – Second" })).toBeNull();
  });

  it("offers no control on an untracked plan when the page is read-only", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([untracked()], false));
    await renderPage("Second");
    expect(queryMutationControls()).toEqual([]);
    expect(cardOf("Second").textContent).toContain("Følges ikke");
  });
});

describe("Roadmap page edge states — legacy completed note", () => {
  it.each(views)("shows the read-only note as text only on the legacy plan, even with canEdit (%s)", async (_n, search) => {
    nav.state.search = search;
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([
        plan({ treeId: "tree-2", areaName: "Legacy", status: "completed", completedAt: null }),
        plan({ treeId: "tree-3", areaName: "Normal done", status: "completed", completedAt: "2026-03-01T00:00:00.000Z" }),
      ]),
    );
    const { user } = await renderReady();
    await user.click(screen.getByRole("button", { name: /^Fullført(e)? \(2\)$/ }));
    expect(cardOf("Legacy").textContent).toContain("Eldre fullført plan – kan ikke endres");
    expect(cardOf("Legacy").textContent).not.toMatch(/Fullført\s*\d/);
    expect(cardOf("Normal done").textContent).not.toContain("kan ikke endres");
  });
});

describe("Roadmap page edge states — archived plans", () => {
  it("hides archived plans by default, reveals them on toggle, and blocks creation either way", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), archivedPlan()]));
    fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1", "tree-2"));
    const { user } = await renderPage();
    expect(screen.queryByRole("heading", { name: "Second" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Planlegg – Second" })).toBeNull();
    await showArchived(user);
    expect(screen.getByRole("heading", { name: "Second" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Planlegg – Second" })).toBeNull();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it.each(views)("offers only restore on a normal archived plan (%s)", async (_n, search) => {
    nav.state.search = search;
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), archivedPlan()]));
    const { user } = await renderPage();
    await showArchived(user);
    const card = cardOf("Second");
    expect(within(card).getByRole("button", { name: "Gjenopprett plan – Second" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /Rediger plan/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: /^Arkiver/ })).toBeNull();
    expect(card.textContent).toContain("Arkivert");
  });

  it("offers no mutation control on an archived legacy plan", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), archivedPlan({ status: "completed", completedAt: null })]));
    const { user } = await renderPage();
    await showArchived(user);
    expect(within(cardOf("Second")).queryAllByRole("button")).toEqual([]);
    expect(updateRoadmapItemMock).not.toHaveBeenCalled();
  });

  it("offers no restore on archived plans when the page is read-only", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([archivedPlan()], false));
    const { user } = await renderReady();
    await showArchived(user);
    expect(screen.getByRole("heading", { name: "Second" })).toBeTruthy();
    expect(queryMutationControls()).toEqual([]);
  });
});

describe("Roadmap page edge states — restore lifecycle", () => {
  it("restores through the existing PATCH, waits for one archived-inclusive refetch, then regroups from server data", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan(), archivedPlan()]));
    const { user } = await renderPage();
    await showArchived(user);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const refetch = deferred<ReturnType<typeof roadmapOk>>();
    fetchRoadmapItemsMock.mockReturnValueOnce(refetch.promise);

    await user.click(screen.getByRole("button", { name: "Gjenopprett plan – Second" }));

    await waitFor(() => expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2));
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("a-token", "team-1", "tree-2", { archived: false });
    // No optimistic update: still archived until the refetch resolves.
    expect(within(cardOf("Second")).getByText("Arkivert")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Arkiverte" })).toBeTruthy();

    refetch.resolve(roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second", status: "planned" })]));

    await waitFor(() => expect(screen.queryByRole("heading", { level: 2, name: "Arkiverte" })).toBeNull());
    const planned = screen.getByRole("heading", { level: 2, name: "Planlagt" }).closest("section") as HTMLElement;
    expect(within(planned).getByRole("heading", { name: "Second" })).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock.mock.calls.every((call) => call[2]?.includeArchived === true)).toBe(true);
  });

  it("lets the restored plan disappear when current filters exclude it", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan(), archivedPlan()]));
    const { user } = await renderPage();
    await showArchived(user);
    await user.selectOptions(screen.getByLabelText("Prioritet"), "high");
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan(), archivedPlan({ archived: false, priority: "low" })]));

    await user.click(screen.getByRole("button", { name: "Gjenopprett plan – Second" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Second" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Containers" })).toBeTruthy();
  });

  it("shows the error and leaves canonical data and requests alone when restore fails with persistence_failed", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan(), archivedPlan()]));
    const { user } = await renderPage();
    await showArchived(user);
    updateRoadmapItemMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    await user.click(screen.getByRole("button", { name: "Gjenopprett plan – Second" }));

    expect(await screen.findByText("Planen ble ikke lagret. Prøv igjen.")).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(within(cardOf("Second")).getByText("Arkivert")).toBeTruthy();
  });

  it("keeps stale data with a saved-but-reload-failed notice when the refetch fails after a successful restore", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan(), archivedPlan()]));
    const { user } = await renderPage();
    await showArchived(user);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "read_failed" });

    await user.click(screen.getByRole("button", { name: "Gjenopprett plan – Second" }));

    expect(await screen.findByText(/Endringen er lagret, men siste planstatus kunne ikke lastes/)).toBeTruthy();
    expect(within(cardOf("Second")).getByText("Arkivert")).toBeTruthy();
  });

  it("shows the no-access state when the refetch after a successful restore is forbidden", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan(), archivedPlan()]));
    const { user } = await renderPage();
    await showArchived(user);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "forbidden" });

    await user.click(screen.getByRole("button", { name: "Gjenopprett plan – Second" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Du har ikke tilgang til denne roadmapen.");
  });
});

describe("Roadmap page edge states — read-only matrix", () => {
  const dataset = () => [plan(), untracked(), archivedPlan({ treeId: "tree-3", areaName: "Third" })];

  it.each(views)("shows plans with no mutation, creation or owner read when canEdit is false (%s)", async (_n, search) => {
    nav.state.search = search;
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(dataset(), false));
    fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1", "tree-4"));
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Områder uten plan" })).toBeNull();
    expect(queryMutationControls()).toEqual([]);
    expect(screen.getByRole("heading", { name: "Second" })).toBeTruthy();
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/inaktiv|administrator|teamleder/i)).toBeNull();
  });

  it.each(views)("keeps plans, filters, archive toggle and view switch usable when skills fail (%s)", async (_n, search) => {
    nav.state.search = search;
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(dataset()));
    fetchTeamSkillsMock.mockResolvedValue({ status: "read_failed" });
    const { user } = await renderPage();
    await screen.findByText(/Planleggingsdata kunne ikke lastes/);
    expect(queryMutationControls()).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Områder uten plan" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Second" })).toBeTruthy();

    await showArchived(user);
    expect(screen.getByRole("heading", { name: "Third" })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Prioritet"), "low");
    expect(screen.getByText(/Ingen treff/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Fjern filtre" }));
    await user.click(screen.getByRole("button", { name: search ? "Liste" : "Tidslinje" }));
    expect(screen.getByRole("heading", { name: "Second" })).toBeTruthy();
    expect(queryMutationControls()).toEqual([]);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(1);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("restores controls only for eligible items after a skills retry, without roadmap or owner reads", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([plan(), untracked(), plan({ treeId: "tree-3", areaName: "Third", status: "completed", completedAt: null })]),
    );
    fetchTeamSkillsMock.mockResolvedValueOnce({ status: "read_failed" }).mockResolvedValueOnce(skillsFor("tree-1", "tree-4"));
    const { user } = await renderPage();
    await screen.findByText(/Planleggingsdata kunne ikke lastes/);

    await user.click(screen.getByRole("button", { name: "Last planleggingsdata på nytt" }));

    await screen.findByRole("button", { name: "Rediger plan – Containers" });
    expect(queryMutationControls().map((el) => el.getAttribute("aria-label")).sort()).toEqual([
      "Planlegg – tree-4",
      "Rediger plan – Containers",
      "Rediger plan – Second",
    ]);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("keeps only the plan whose area is missing read-only while another area stays creatable", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second" })]));
    fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1", "tree-3"));
    await renderPage("Containers");
    await screen.findByRole("button", { name: "Planlegg – Third" });
    expect(screen.getByRole("button", { name: "Rediger plan – Containers" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Rediger plan – Second/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Planlegg – Second" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Second" })).toBeTruthy();
  });
});

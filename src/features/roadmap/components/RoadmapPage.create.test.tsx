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
const AREA_NAMES: Record<string, string> = { "tree-1": "Containers", "tree-2": "Second", "tree-3": "Third" };

function skillsFor(...treeIds: string[]) {
  return {
    status: "ok",
    skills: treeIds.map((treeId) => ({ treeId, name: AREA_NAMES[treeId] ?? treeId, nodes: NODES, currentNodeId: "node-1" })),
    canReportProgress: true,
  };
}

function roadmapOk(items: RoadmapItemView[], canEdit = true, truncated = false) {
  return { status: "ok", items, canEdit, truncated };
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
  fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1", "tree-2"));
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

async function renderPage() {
  const user = userEvent.setup();
  render(<RoadmapPage teamId="team-1" />);
  await screen.findByRole("heading", { name: "Platform" });
  await waitFor(() => expect(fetchRoadmapItemsMock).toHaveBeenCalled());
  return user;
}

const SECTION = { name: "Områder uten plan" };
const section = () => screen.queryByRole("heading", SECTION);
const createButton = (area: string) => screen.queryByRole("button", { name: `Planlegg – ${area}` });

async function waitForSection() {
  return screen.findByRole("heading", SECTION);
}

describe("Områder uten plan — eligibility from skills minus canonical roadmap", () => {
  it.each([
    ["active", { status: "active" as const }],
    ["planned", { status: "planned" as const }],
    ["completed", { status: "completed" as const, completedAt: "2026-03-01T00:00:00.000Z" }],
    ["archived", { archived: true }],
    ["legacy completed (completedAt null)", { status: "completed" as const, completedAt: null }],
  ])("does not offer an area whose plan is %s", async (_name, overrides) => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second", ...overrides })]));
    await renderPage();
    await screen.findByRole("heading", { name: "Containers" });
    expect(section()).toBeNull();
    expect(createButton("Second")).toBeNull();
  });

  it("offers an area absent from the canonical roadmap, and only that one", async () => {
    await renderPage();
    await waitForSection();
    expect(createButton("Second")).toBeTruthy();
    expect(createButton("Containers")).toBeNull();
  });

  it("never offers areas that are not in the skills read", async () => {
    fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1"));
    await renderPage();
    await screen.findByRole("heading", { name: "Containers" });
    expect(section()).toBeNull();
  });
});

describe("Områder uten plan — independent of filters, archive toggle and view", () => {
  async function setup() {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([
        plan({ treeId: "tree-1", areaName: "Containers", status: "active", priority: "high" }),
        plan({ treeId: "tree-2", areaName: "Second", archived: true }),
      ]),
    );
    fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1", "tree-2", "tree-3"));
    const user = await renderPage();
    await waitForSection();
    return user;
  }

  it("keeps exactly the uncovered area eligible across archive toggle, filters and view switch, with no owner or roadmap reads", async () => {
    const user = await setup();
    const check = () => {
      expect(createButton("Third")).toBeTruthy();
      expect(createButton("Second")).toBeNull();
      expect(createButton("Containers")).toBeNull();
    };
    check();
    await user.click(screen.getByRole("checkbox", { name: "Vis arkiverte" }));
    check();
    await user.selectOptions(screen.getByLabelText("Status"), "completed");
    check();
    await user.selectOptions(screen.getByLabelText("Status"), "all");
    await user.selectOptions(screen.getByLabelText("Prioritet"), "low");
    check();
    await user.click(screen.getByRole("button", { name: "Tidslinje" }));
    check();
    await user.click(screen.getByRole("checkbox", { name: "Vis arkiverte" }));
    check();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });
});

describe("Områder uten plan — capability", () => {
  it("is absent when canEdit is false", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan()], false));
    await renderPage();
    await screen.findByRole("heading", { name: "Containers" });
    expect(section()).toBeNull();
    expect(queryMutationControls()).toEqual([]);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("is absent while skills load", async () => {
    fetchTeamSkillsMock.mockReturnValue(new Promise(() => {}));
    await renderPage();
    await screen.findByRole("heading", { name: "Containers" });
    expect(section()).toBeNull();
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("is absent on skills failure and appears after retry without roadmap or owner reads", async () => {
    fetchTeamSkillsMock.mockResolvedValueOnce({ status: "read_failed" }).mockResolvedValueOnce(skillsFor("tree-1", "tree-2"));
    const user = await renderPage();
    await screen.findByText(/Planleggingsdata kunne ikke lastes/);
    expect(section()).toBeNull();

    await user.click(screen.getByRole("button", { name: "Last planleggingsdata på nytt" }));

    await waitForSection();
    expect(createButton("Second")).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("is withheld when the canonical response is truncated (eligibility cannot be proven)", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan()], true, true));
    await renderPage();
    await screen.findByRole("heading", { name: "Containers" });
    expect(section()).toBeNull();
    expect(screen.getByText(/Listen kan være ufullstendig/)).toBeTruthy();
  });
});

describe("Områder uten plan — zero states", () => {
  it("shows the empty state and the creation section when no plans exist but areas are eligible", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([]));
    await renderPage();
    await waitForSection();
    expect(screen.getByText(/Ingen planer ennå/)).toBeTruthy();
    expect(createButton("Containers")).toBeTruthy();
    expect(createButton("Second")).toBeTruthy();
  });

  it("shows only the read-only empty state for a read-only user", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([], false));
    await renderPage();
    await screen.findByText(/Ingen planer ennå/);
    expect(section()).toBeNull();
    expect(queryMutationControls()).toEqual([]);
  });

  it("omits the section when every area already has a plan", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second" })]));
    await renderPage();
    await screen.findByRole("heading", { name: "Second" });
    expect(section()).toBeNull();
  });

  it("does not offer archived areas when all plans are archived and hidden, and points to Vis arkiverte", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([plan({ archived: true }), plan({ treeId: "tree-2", areaName: "Second", archived: true })]),
    );
    await renderPage();
    await screen.findByText(/Alle planer er arkivert/);
    expect(section()).toBeNull();
    expect(createButton("Containers")).toBeNull();
  });
});

describe("Områder uten plan — creation lifecycle", () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await waitForSection();
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
    await user.click(createButton("Second")!);
    const form = screen.getByRole("form", { name: "Ny plan – Second" });
    await waitFor(() => expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(1));
    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    return form;
  }

  it("POSTs the canonical body, refetches once after success, and only then moves the area out of the section", async () => {
    const refetch = deferred<ReturnType<typeof roadmapOk>>();
    createRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = await renderPage();
    const form = await openCreate(user);
    fetchRoadmapItemsMock.mockReturnValueOnce(refetch.promise);

    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    await waitFor(() => expect(createRoadmapItemMock).toHaveBeenCalledTimes(1));
    expect(createRoadmapItemMock).toHaveBeenCalledWith(
      "a-token",
      "team-1",
      expect.objectContaining({ treeId: "tree-2", targetNodeId: "node-2", priority: "medium" }),
    );
    await waitFor(() => expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2));
    // Pending refetch: canonical data and eligibility are unchanged, nothing inserted optimistically.
    expect(screen.queryByRole("button", { name: "Rediger plan – Second" })).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Second" })).toHaveLength(1);
    expect(section()).toBeTruthy();

    refetch.resolve(roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second", priority: "medium", status: "planned" })]));

    await waitFor(() => expect(section()).toBeNull());
    expect(screen.getByRole("button", { name: "Rediger plan – Second" })).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock.mock.calls[1]?.[2]).toEqual(fetchRoadmapItemsMock.mock.calls[0]?.[2]);
    expect(updateRoadmapItemMock).not.toHaveBeenCalled();
  });

  it("removes the area from eligibility after refetch even if the new plan is filtered out", async () => {
    createRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = await renderPage();
    await waitForSection();
    await user.selectOptions(screen.getByLabelText("Prioritet"), "high");
    const form = await openCreate(user);
    fetchRoadmapItemsMock.mockResolvedValueOnce(
      roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second", priority: "medium" })]),
    );
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    await waitFor(() => expect(section()).toBeNull());
    expect(screen.queryByRole("heading", { name: "Second" })).toBeNull();
  });

  it("keeps the area eligible and shows the error when the POST fails, without refetching", async () => {
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const user = await renderPage();
    const form = await openCreate(user);
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await screen.findByText(/Planen ble ikke lagret/)).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(createButton("Second")).toBeNull(); // form still open for the same area
    expect(screen.getByRole("form", { name: "Ny plan – Second" })).toBeTruthy();
    expect(section()).toBeTruthy();
  });

  it("keeps stale canonical data (area still eligible) and shows the saved-but-reload notice when the refresh fails", async () => {
    createRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = await renderPage();
    const form = await openCreate(user);
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "read_failed" });
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await screen.findByText(/Endringen er lagret, men siste planstatus/)).toBeTruthy();
    expect(section()).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Containers" })).toBeTruthy();
  });

  it("becomes no-access when the post-create refresh is forbidden", async () => {
    createRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = await renderPage();
    const form = await openCreate(user);
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "forbidden" });
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await screen.findByText("Du har ikke tilgang til denne roadmapen.")).toBeTruthy();
    expect(section()).toBeNull();
  });

  it("surfaces already_planned via the existing copy and refetches, never converting to a PATCH", async () => {
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: "already_planned" });
    const user = await renderPage();
    const form = await openCreate(user);
    fetchRoadmapItemsMock.mockResolvedValueOnce(
      roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second" })]),
    );
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    await waitFor(() => expect(section()).toBeNull());
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(updateRoadmapItemMock).not.toHaveBeenCalled();
  });

  it("reuses already-loaded owners when a second creation editor opens", async () => {
    fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1", "tree-2", "tree-3"));
    const user = await renderPage();
    await waitForSection();
    await user.click(createButton("Second")!);
    await waitFor(() => expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(1));
    await user.click(createButton("Third")!);
    expect(screen.getByRole("form", { name: "Ny plan – Third" })).toBeTruthy();
    expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(1);
  });

  it("does not render memberRef values", async () => {
    const user = await renderPage();
    await openCreate(user);
    expect(document.body.textContent).not.toContain("ref-alex-secret");
  });
});

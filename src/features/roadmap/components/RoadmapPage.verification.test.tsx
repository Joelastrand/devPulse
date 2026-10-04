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

const SECRET_REF = "ref-owner-secret-9f3";

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
const AREA_NAMES: Record<string, string> = { "tree-1": "Containers", "tree-2": "Second", "tree-3": "Third", "tree-4": "Fourth" };

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
  members: [{ memberRef: SECRET_REF, displayName: "Alex", ordinal: null, isSelf: false }],
  unavailableCount: 0,
  truncated: false,
};

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

async function renderReady() {
  const user = userEvent.setup();
  const view = render(<RoadmapPage teamId="team-1" />);
  await screen.findByRole("checkbox", { name: "Vis arkiverte" });
  return { user, ...view };
}

const views = [["list", ""], ["timeline", "view=timeline"]] as const;
const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";
const done = (overrides: Partial<RoadmapItemView> = {}) =>
  plan({ treeId: "tree-3", areaName: "Third", status: "completed", completedAt: "2026-03-01T00:00:00.000Z", ...overrides });

describe("TASK-012 — mid-session permission loss", () => {
  it("becomes an ordinary read-only page when the canonical refetch returns canEdit=false (not no-access)", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second", archived: true })]));
    const { user } = await renderReady();
    expect(screen.getByRole("button", { name: "Rediger plan – Containers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Planlegg – Third" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Områder uten plan" })).toBeTruthy();

    fetchRoadmapItemsMock.mockResolvedValueOnce(
      roadmapOk([plan({ priority: "low" }), plan({ treeId: "tree-2", areaName: "Second", archived: true })], false),
    );
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    await user.click(screen.getByRole("button", { name: "Rediger plan – Containers" }));
    const form = screen.getByRole("form", { name: "Rediger plan – Containers" });
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    const ownerReadsBeforeRefetch = fetchAssignableMembersMock.mock.calls.length;
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Rediger plan – Containers" })).toBeNull());
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock).toHaveBeenLastCalledWith("a-token", "team-1", { includeArchived: true });
    // Readable, not no-access.
    expect(screen.queryByText("Du har ikke tilgang til denne roadmapen.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Containers" })).toBeTruthy();
    expect(screen.getByText("Lav", { selector: "dd" })).toBeTruthy();
    // No mutation capability anywhere: edit, archive, restore, forms, creation.
    expect(queryMutationControls()).toEqual([]);
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Områder uten plan" })).toBeNull();
    // Losing permission is not a reason to read owners.
    expect(fetchAssignableMembersMock.mock.calls.length).toBe(ownerReadsBeforeRefetch);

    // Local read-only interactions still work without any further read.
    await user.click(screen.getByRole("checkbox", { name: "Vis arkiverte" }));
    expect(screen.getByRole("heading", { name: "Second" })).toBeTruthy();
    expect(queryMutationControls()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Tidslinje" }));
    expect(screen.getByRole("button", { name: "Tidslinje" }).getAttribute("aria-pressed")).toBe("true");
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
  });

  it("still maps a forbidden authoritative refetch to the no-access state", async () => {
    const { user } = await renderReady();
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "forbidden" });
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    await user.click(screen.getByRole("button", { name: "Rediger plan – Containers" }));
    const form = screen.getByRole("form", { name: "Rediger plan – Containers" });
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await screen.findByText("Du har ikke tilgang til denne roadmapen.")).toBeTruthy();
    expect(queryMutationControls()).toEqual([]);
  });
});

describe("TASK-012 — skills pending hardening", () => {
  it("keeps plans readable with no mutation control, no unplanned section and no owner read while skills load", async () => {
    fetchTeamSkillsMock.mockReturnValue(new Promise(() => {}));
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second", archived: true })]));
    const { user } = await renderReady();
    expect(screen.getByRole("heading", { name: "Containers" })).toBeTruthy();
    expect(screen.getByText("Laster planleggingsdata…")).toBeTruthy();
    expect(queryMutationControls()).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Områder uten plan" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Vis arkiverte" }));
    expect(queryMutationControls()).toEqual([]);
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("offers no creation on the zero-plan page while skills are pending", async () => {
    fetchTeamSkillsMock.mockReturnValue(new Promise(() => {}));
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([]));
    render(<RoadmapPage teamId="team-1" />);
    await screen.findByText(/Ingen planer ennå/);
    expect(queryMutationControls()).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Områder uten plan" })).toBeNull();
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });
});

describe("TASK-012 — accessibility structure", () => {
  it.each(views)("has one h1, h2 sections, h3 plan headings and unique repeated control names (%s)", async (_n, search) => {
    nav.state.search = search;
    fetchTeamSkillsMock.mockResolvedValue(skillsFor("tree-1", "tree-2", "tree-3", "tree-4"));
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second", status: "planned", targetDate: "2026-11-15" }), done()]),
    );
    const { user } = await renderReady();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Platform");
    expect(screen.getByRole("heading", { level: 2, name: "Områder uten plan" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Containers" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Fourth" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^Fullført/ }));
    const names = queryMutationControls().map((control) => control.getAttribute("aria-label") ?? control.textContent);
    expect(names.length).toBeGreaterThan(3);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/ – /);
  });

  it("gives every restore control its own area-specific name when several archived plans are visible", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([plan({ archived: true }), plan({ treeId: "tree-2", areaName: "Second", archived: true }), plan({ treeId: "tree-3", areaName: "Third" })]),
    );
    const { user } = await renderReady();
    await user.click(screen.getByRole("checkbox", { name: "Vis arkiverte" }));
    expect(screen.getByRole("button", { name: "Gjenopprett plan – Containers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gjenopprett plan – Second" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Rediger plan – (Containers|Second)/ })).toBeNull();
  });

  it.each(views)("wires the completed disclosure to a unique region that is inert while collapsed (%s)", async (_n, search) => {
    nav.state.search = search;
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), done()]));
    const { user, container } = await renderReady();
    const toggle = screen.getByRole("button", { name: /^Fullført.* \(1\)$/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const regionId = toggle.getAttribute("aria-controls") as string;
    const region = container.querySelector(`#${regionId}`) as HTMLElement;
    expect(container.querySelectorAll(`#${regionId}`)).toHaveLength(1);
    expect(region.hidden).toBe(true);
    expect(region.querySelectorAll(FOCUSABLE)).toHaveLength(0);

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(region.hidden).toBe(false);
    expect(within(region).getByRole("heading", { name: "Third" })).toBeTruthy();

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(region.hidden).toBe(true);
  });

  it.each(views)("wires the edit disclosure with aria-expanded/aria-controls to a unique hidden region (%s)", async (_n, search) => {
    nav.state.search = search;
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan(), plan({ treeId: "tree-2", areaName: "Second" })]));
    const { user, container } = await renderReady();
    const triggers = ["Containers", "Second"].map((area) => screen.getByRole("button", { name: `Rediger plan – ${area}` }));
    const ids = triggers.map((trigger) => trigger.getAttribute("aria-controls") as string);
    expect(new Set(ids).size).toBe(2);
    for (const [index, trigger] of triggers.entries()) {
      const region = container.querySelector(`[id="${ids[index]}"]`) as HTMLElement;
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(region.hidden).toBe(true);
      expect(region.querySelectorAll(FOCUSABLE)).toHaveLength(0);
    }
    await user.click(triggers[0]);
    expect(triggers[0].getAttribute("aria-expanded")).toBe("true");
    const form = screen.getByRole("form", { name: "Rediger plan – Containers" });
    expect(container.querySelector(`[id="${ids[0]}"]`)?.contains(form)).toBe(true);
    // Focus returns to the trigger when the form is cancelled.
    await user.click(within(form).getByRole("button", { name: "Avbryt" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rediger plan – Containers" }));
  });

  it("labels every planning field and exposes the locked target and its explanation on an untracked plan", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan({ tracking: { state: "not_tracked" } })]));
    const { user } = await renderReady();
    await user.click(screen.getByRole("button", { name: "Rediger plan – Containers" }));
    const form = screen.getByRole("form", { name: "Rediger plan – Containers" });
    for (const label of ["Prioritet", "Status", "Startdato", "Måldato", "Ansvarlig"]) {
      expect(within(form).getByLabelText(label)).toBeTruthy();
    }
    expect((within(form).getByLabelText("Prioritet") as HTMLSelectElement).disabled).toBe(false);
    // The locked target is plain text, not a disabled-looking control, and the card explains why.
    expect(within(form).queryByLabelText("Målstadium")).toBeNull();
    expect(within(form).getByText(/Målstadiet kan ikke endres så lenge teamet ikke følger området/)).toBeTruthy();
    expect(screen.getByText(/Teamet følger ikke lenger dette kompetanseområdet/)).toBeTruthy();
  });

  it.each(views)("keeps filters, view switch and clear-filter operable by keyboard without tabindex tricks (%s)", async (_n, search) => {
    nav.state.search = search;
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan()]));
    const { user, container } = await renderReady();
    expect(container.querySelectorAll("[tabindex]:not([tabindex='-1']):not([tabindex='0'])")).toHaveLength(0);
    expect(screen.getByRole("group", { name: "Filtrer planer" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Visning" })).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "completed");
    expect(screen.queryByRole("heading", { name: "Containers" })).toBeNull();
    screen.getByRole("button", { name: "Fjern filtre" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Containers" })).toBeTruthy();
    // Timeline is heading → ordered list; the list view uses unordered lists.
    expect(container.querySelectorAll(search ? "section > ol > li > article" : "section > ul > li > article").length).toBeGreaterThan(0);
  });

  it("exposes truncation and all-archived notices as ordinary text, not assertive live regions", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk([plan({ archived: true })], true, true));
    const { container } = await renderReady();
    expect(screen.getByText(/Alle planer er arkivert/)).toBeTruthy();
    const notice = screen.getByText(/Listen kan være ufullstendig/);
    expect(notice.closest("[role='alert']")).toBeNull();
    expect(container.querySelector("[aria-live='assertive']")).toBeNull();
    // Truncated response withholds creation.
    expect(screen.queryByRole("heading", { name: "Områder uten plan" })).toBeNull();
  });
});

describe("TASK-012 — privacy and anti-surveillance sweep", () => {
  const FORBIDDEN = [SECRET_REF, "uid-", "authorTag", "challenge", "@example", "tree-1", "tree-2"];

  function userFacingSurface(root: HTMLElement) {
    const strings: string[] = [root.textContent ?? ""];
    for (const element of Array.from(root.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        // The approved opaque, team-scoped owner option value is the only sanctioned carrier of a memberRef.
        if (element.tagName === "OPTION" && attribute.name === "value") continue;
        // Element ids/references are structural wiring, not presentation.
        if (attribute.name === "id" || attribute.name === "for" || ["aria-controls", "aria-describedby", "aria-labelledby"].includes(attribute.name)) continue;
        strings.push(`${attribute.name}=${attribute.value}`);
      }
    }
    return strings.join("\n");
  }

  it.each(views)("never exposes identity in text, accessible names or attributes with an editor open (%s)", async (_n, search) => {
    nav.state.search = search;
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([
        plan({ owner: { state: "current", memberRef: SECRET_REF, displayName: "Alex", ordinal: null, isSelf: false } }),
        plan({ treeId: "tree-2", areaName: null, targetAvailable: false, targetLabel: null, owner: { state: "unavailable" } }),
      ]),
    );
    const { user, container } = await renderReady();
    await user.click(screen.getByRole("button", { name: "Rediger plan – Containers" }));
    await screen.findByRole("option", { name: "Alex" });
    const surface = userFacingSurface(container);
    for (const token of FORBIDDEN) expect(surface, token).not.toContain(token);
    expect(screen.getByText("Ukjent område")).toBeTruthy();
    expect(screen.getByText("Målstadiet er ikke tilgjengelig", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("Ansvarlig er ikke lenger tilgjengelig", { selector: "dd" })).toBeTruthy();
    expect(nav.state.search === "" || nav.state.search === "view=timeline").toBe(true);
  });

  it("keeps the summary to plan-state counts, with no owner, rate, score or history wording", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([
        plan({ owner: { state: "current", memberRef: SECRET_REF, displayName: "Alex", ordinal: null, isSelf: false } }),
        done(),
      ]),
    );
    const { container } = await renderReady();
    const summary = screen.getByText(/^Planer:/);
    expect(summary.textContent).toBe("Planer: 1 pågår · 0 planlagt · 1 fullført");
    expect(container.textContent).not.toMatch(/historikk|endringslogg|tidligere|poeng|score|rangering|leaderboard|fullføringsgrad|%/i);
    expect(screen.getByText("Roadmapen viser teamets gjeldende plan for hvert kompetanseområde.")).toBeTruthy();
  });
});

describe("TASK-012 — responsive structure", () => {
  it.each(views)("wraps filters and view switch, stacks facts and breaks long names without fixed widths (%s)", async (_n, search) => {
    nav.state.search = search;
    const longName = "Supercalifragilisticexpialidocious-".repeat(4);
    const longOwner = "Bertil ".repeat(12).trim();
    fetchTeamSkillsMock.mockResolvedValue({
      status: "ok",
      skills: [{ treeId: "tree-1", name: longName, nodes: NODES, currentNodeId: "node-1" }, ...skillsFor("tree-4").skills],
      canReportProgress: true,
    });
    fetchRoadmapItemsMock.mockResolvedValue(
      roadmapOk([plan({ areaName: longName, owner: { state: "current", memberRef: SECRET_REF, displayName: longOwner, ordinal: null, isSelf: false } })]),
    );
    const { user, container } = await renderReady();
    await user.click(screen.getByRole("button", { name: `Rediger plan – ${longName}` }));

    const filters = screen.getByRole("group", { name: "Filtrer planer" });
    expect(filters.className).toMatch(/\bflex-wrap\b/);
    expect(filters.className).toMatch(/\bmin-w-0\b/);
    expect(screen.getByRole("group", { name: "Visning" }).className).toMatch(/\bflex-wrap\b/);
    const heading = screen.getByRole("heading", { level: 3, name: longName });
    expect(heading.className).toMatch(/\bbreak-words\b/);
    const facts = heading.closest("article")?.querySelector("dl") as HTMLElement;
    expect(facts.className).toMatch(/\bgrid-cols-1\b/);
    expect(within(facts).getByText(longOwner).className).toMatch(/\bbreak-words\b/);
    expect(screen.getByRole("heading", { level: 3, name: "Fourth" }).className).toMatch(/\bbreak-words\b/);

    const offenders = Array.from(container.querySelectorAll("*")).filter((element) =>
      /(^|\s)(w-\[\d+px\]|w-\d{2,}|min-w-\[\d+px\]|whitespace-nowrap|overflow-x-(auto|scroll))(\s|$)/.test(element.getAttribute("class") ?? ""),
    );
    expect(offenders.map((element) => element.outerHTML.slice(0, 80))).toEqual([]);
  });
});

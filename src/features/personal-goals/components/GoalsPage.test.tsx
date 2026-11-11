// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { goalsCopy } from "../copy";
import { expectHeadingStructure } from "../../../components/ui/heading-structure";
import type { GoalDto, GoalListResponse } from "../domain/goal";

const observeIdTokenMock = vi.fn();
const fetchGoalsMock = vi.fn();
const createGoalMock = vi.fn();
const updateGoalMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../client/goals-gateway", () => ({
  fetchGoals: fetchGoalsMock,
  createGoal: createGoalMock,
  updateGoal: updateGoalMock,
}));

const { GoalsPage } = await import("./GoalsPage");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function goal(overrides: Partial<GoalDto> = {}): GoalDto {
  return {
    id: "goal-1",
    title: "Lær Rust",
    status: "active",
    treeId: null,
    areaName: null,
    areaAvailable: true,
    targetDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function response(overrides: Partial<GoalListResponse> = {}): { status: "ok"; response: GoalListResponse } {
  return {
    status: "ok",
    response: { goals: [], recoveryItems: [], truncated: false, skillOptions: [], skillOptionsTruncated: false, ...overrides },
  };
}

// Each row's secondary actions sit in a disclosure whose summary is part of the row text.
const active = `${goalsCopy.actionsSummary}${goalsCopy.editButton}${goalsCopy.completeButton}${goalsCopy.deleteButton}`;
const done = `${goalsCopy.actionsSummary}${goalsCopy.editButton}${goalsCopy.reopenButton}${goalsCopy.deleteButton}`;

function signedInWith(result: unknown) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchGoalsMock.mockResolvedValue(result);
}

async function renderReady(overrides: Partial<GoalListResponse> = {}) {
  signedInWith(response(overrides));
  render(<GoalsPage />);
  await screen.findByText(goalsCopy.privacyNotice);
}

describe("GoalsPage", () => {
  it("signed out: shows a sign-in link and makes no request", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback(null);
      return () => {};
    });
    render(<GoalsPage />);
    expect((await screen.findByRole("link", { name: "Logg inn" })).getAttribute("href")).toBe("/sign-in");
    expect(fetchGoalsMock).not.toHaveBeenCalled();
  });

  it("shows a loading status, no empty state and issues one GET while pending", () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback("a-token");
      return () => {};
    });
    fetchGoalsMock.mockReturnValue(new Promise(() => {}));
    render(<GoalsPage />);
    expect(screen.getByRole("status").textContent).toBe(goalsCopy.loading);
    expect(screen.queryByText(goalsCopy.empty)).toBeNull();
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);
    expect(fetchGoalsMock).toHaveBeenCalledWith("a-token");
  });

  it("shows the empty state, with the privacy copy, only when goals and recovery items are both empty", async () => {
    await renderReady();
    expect(screen.getByText(goalsCopy.empty)).toBeTruthy();
    expect(screen.getByText(goalsCopy.privacyNotice)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);
  });

  it("offers a create button in every ready state, opening the create region without any request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      for (const overrides of [{}, { goals: [goal()] }, { recoveryItems: [{ goalId: "r" }] }]) {
        await renderReady(overrides);
        const button = screen.getByRole("button", { name: goalsCopy.createButton });
        expect(button.getAttribute("aria-expanded")).toBe("false");
        expect(button.getAttribute("aria-controls")).toBe("create-goal-region");
        const region = document.getElementById("create-goal-region");
        expect(region?.hidden).toBe(true);
        expect(region?.querySelector("form")).toBeNull();

        await userEvent.click(button);
        expect(button.getAttribute("aria-expanded")).toBe("true");
        expect(region?.hidden).toBe(false);
        expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: goalsCopy.createHeading }));
        expect(region?.querySelector("form")).not.toBeNull();

        await userEvent.click(button);
        expect(button.getAttribute("aria-expanded")).toBe("false");
        expect(region?.hidden).toBe(true);
        cleanup();
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(createGoalMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows active goals as a list with text status, area and target date, in server order", async () => {
    await renderReady({
      goals: [
        goal({ id: "a", title: "Første" }),
        goal({ id: "b", title: "Andre", treeId: "t1", areaName: "Arkitektur", targetDate: "2020-01-15" }),
      ],
    });
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      `Første${goalsCopy.statusActive}${active}`,
      `Andre${goalsCopy.statusActive}Ferdighetsområde: ArkitekturMåldato: 2020-01-15${active}`,
    ]);
    expect(screen.getByRole("heading", { level: 2, name: goalsCopy.activeHeading })).toBeTruthy();
  });

  it("shows a past target date as plain text with no overdue wording", async () => {
    await renderReady({ goals: [goal({ targetDate: "2020-01-01" })] });
    expect(screen.getByText("Måldato: 2020-01-01")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/forsinket|overskredet|utløpt|overdue/i);
  });

  it("shows neutral text for an unavailable linked area, nothing for an unlinked goal, and never the treeId", async () => {
    await renderReady({
      goals: [
        goal({ id: "a", title: "Uten", treeId: null }),
        goal({ id: "b", title: "Borte", treeId: "tree-secret", areaName: null, areaAvailable: false }),
      ],
    });
    expect(screen.getAllByText(goalsCopy.areaUnavailable)).toHaveLength(1);
    const [without, gone] = screen.getAllByRole("listitem");
    expect(without?.textContent).not.toMatch(/ferdighetsområde/i);
    expect(gone?.textContent).toContain("Borte");
    expect(document.body.textContent).not.toContain("tree-secret");
  });

  it("groups completed goals in a collapsed disclosure labelled with the count, preserving order", async () => {
    await renderReady({
      goals: [
        goal({ id: "a", title: "Aktiv" }),
        goal({ id: "b", title: "Ferdig 1", status: "completed", completedAt: "2026-02-01T00:00:00.000Z" }),
        goal({ id: "c", title: "Ferdig 2", status: "completed", completedAt: "2026-02-02T00:00:00.000Z" }),
      ],
    });
    const summary = screen.getByText(goalsCopy.completedSummary(2));
    const details = summary.closest("details");
    expect(details?.open).toBe(false);
    const items = within(details as HTMLElement).getAllByRole("listitem", { hidden: true });
    expect(items.map((item) => item.textContent)).toEqual([
      `Ferdig 1${goalsCopy.statusCompleted}${done}`,
      `Ferdig 2${goalsCopy.statusCompleted}${done}`,
    ]);
    await userEvent.click(summary);
    expect(details?.open).toBe(true);
    // Active list holds only the active goal.
    expect(screen.getByText("Aktiv").closest("ul")?.querySelectorAll("li")).toHaveLength(1);
  });

  it("renders no disclosure without completed goals and a note when only completed goals exist", async () => {
    await renderReady({ goals: [goal({ status: "completed", completedAt: "2026-02-01T00:00:00.000Z" })] });
    expect(screen.getByText(goalsCopy.noActiveGoals)).toBeTruthy();
    cleanup();
    await renderReady({ goals: [goal()] });
    // Only the row's own actions disclosure exists; there is no completed-goals group.
    expect(Array.from(document.querySelectorAll("details > summary")).map((summary) => summary.textContent)).toEqual([
      goalsCopy.actionsSummary,
    ]);
  });

  it("renders titles as inert text", async () => {
    await renderReady({ goals: [goal({ title: '<img src=x onerror="alert(1)"> **fet** https://example.com' })] });
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("a[href='https://example.com']")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeTruthy();
  });

  it("shows recovery items as neutral read-only text with no goalId and no controls, even with no goals", async () => {
    await renderReady({ recoveryItems: [{ goalId: "secret-id-1" }, { goalId: "secret-id-2" }] });
    expect(screen.getByText(goalsCopy.recoveryNotice(2))).toBeTruthy();
    expect(screen.getByRole("button", { name: goalsCopy.recoveryDeleteButtonName(2, 2) })).toBeTruthy();
    expect(screen.queryByText(goalsCopy.empty)).toBeNull();
    expect(document.body.textContent).not.toContain("secret-id");
    // Recovery items offer exactly one action each, delete (TASK-014); no edit, complete or reopen.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      goalsCopy.createButton,
      goalsCopy.deleteButton,
      goalsCopy.deleteButton,
    ]);
    cleanup();
    await renderReady({ recoveryItems: [{ goalId: "x" }] });
    expect(screen.getByText(goalsCopy.recoveryNotice(1))).toBeTruthy();
  });

  it("shows the truncation notice only when truncated, without a count", async () => {
    await renderReady({ goals: [goal()], truncated: true });
    expect(screen.getByText(goalsCopy.truncatedNotice)).toBeTruthy();
    expect(goalsCopy.truncatedNotice).not.toMatch(/\d/);
    cleanup();
    await renderReady({ goals: [goal()], truncated: false });
    expect(screen.queryByText(goalsCopy.truncatedNotice)).toBeNull();
  });

  it("shows the options-truncation notice separately from the goal truncation notice", async () => {
    await renderReady({ goals: [goal()], skillOptionsTruncated: true });
    expect(screen.getByText(goalsCopy.skillOptionsTruncatedNotice)).toBeTruthy();
    expect(screen.queryByText(goalsCopy.truncatedNotice)).toBeNull();
    cleanup();
    await renderReady({ goals: [goal()], truncated: true, skillOptionsTruncated: false });
    expect(screen.queryByText(goalsCopy.skillOptionsTruncatedNotice)).toBeNull();
  });

  it("load failure: alert with retry, no goals, no empty state; retry re-runs the GET only", async () => {
    signedInWith({ status: "read_failed" });
    render(<GoalsPage />);
    expect((await screen.findByRole("alert")).textContent).toBe(goalsCopy.loadError);
    expect(screen.queryByText(goalsCopy.empty)).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);

    fetchGoalsMock.mockResolvedValue(response({ goals: [goal({ title: "Etter retry" })] }));
    await userEvent.click(screen.getByRole("button", { name: goalsCopy.retryButton }));
    await screen.findByText("Etter retry");
    expect(fetchGoalsMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a 401 moves to the signed-out state and shows no goals", async () => {
    signedInWith({ status: "unauthenticated" });
    render(<GoalsPage />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Logg inn" })).toBeTruthy());
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("with goals and recovery items offers no repair or restore control", async () => {
    await renderReady({
      goals: [goal(), goal({ id: "c", title: "Ferdig", status: "completed", completedAt: "2026-02-01T00:00:00.000Z" })],
      recoveryItems: [{ goalId: "r" }],
    });
    expect(screen.queryByRole("button", { name: /reparer|gjenopprett|arkiv/i })).toBeNull();
  });
});

describe("GoalsPage composition (visual-redesign TASK-011)", () => {
  it("filters the list with the status tabs, which show counts", async () => {
    await renderReady({
      goals: [
        goal({ id: "a", title: "Aktivt mål", status: "active" }),
        goal({ id: "b", title: "Ferdig mål", status: "completed", completedAt: "2026-02-01T00:00:00.000Z" }),
      ],
    });
    const user = userEvent.setup();

    // Filters carry no counts; the summary strip is the only place a count appears.
    expect(screen.getByRole("button", { name: goalsCopy.tabs.active }).getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByRole("button", { name: goalsCopy.tabs.completed }));
    expect(screen.getByRole("button", { name: goalsCopy.tabs.completed }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Ferdig mål")).toBeTruthy();
    expect(screen.queryByText("Aktivt mål")).toBeNull();

    await user.click(screen.getByRole("button", { name: goalsCopy.tabs.active }));
    expect(screen.getByText("Aktivt mål")).toBeTruthy();
    expect(screen.queryByText("Ferdig mål")).toBeNull();

    await user.click(screen.getByRole("button", { name: goalsCopy.tabs.all }));
    expect(screen.getByText("Aktivt mål")).toBeTruthy();
    expect(screen.getByText(goalsCopy.completedSummary(1))).toBeTruthy();
  });

  it("counts only active goals due today or within 30 days in the due-soon tile, never overdue, completed or later goals", async () => {
    const now = new Date();
    const at = (days: number) => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    await renderReady({
      goals: [
        goal({ id: "today", title: "I dag", targetDate: at(0) }),
        goal({ id: "soon", title: "Om tjue dager", targetDate: at(20) }),
        goal({ id: "later", title: "Om seksti dager", targetDate: at(60) }),
        goal({ id: "overdue", title: "Forfalt", targetDate: at(-3) }),
        goal({ id: "done", title: "Ferdig", status: "completed", targetDate: at(5), completedAt: "2026-02-01T00:00:00.000Z" }),
      ],
    });

    expect(screen.getByLabelText(goalsCopy.summary.label).textContent).toContain(`${goalsCopy.summary.dueSoon}2`);
  });

  it("shows the summary counts as stat tiles, with no progress indicator or percentage", async () => {
    await renderReady({
      goals: [
        goal({ id: "a", title: "Aktivt mål", status: "active" }),
        goal({ id: "b", title: "Ferdig mål", status: "completed", completedAt: "2026-02-01T00:00:00.000Z" }),
      ],
    });

    // Label and value pairs, in order: active, completed, and due within 30 days (none here, the goals have no date).
    expect(screen.getByLabelText(goalsCopy.summary.label).textContent).toBe(
      `${goalsCopy.summary.active}1${goalsCopy.summary.completed}1${goalsCopy.summary.dueSoon}0`,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\d+\s?%/);
  });

  it("lists only the linked skill areas in the side panel", async () => {
    await renderReady({
      goals: [
        goal({ id: "a", title: "Første", areaName: "Arkitektur" }),
        goal({ id: "b", title: "Andre", areaName: "Arkitektur" }),
        goal({ id: "c", title: "Tredje", areaName: null }),
      ],
    });

    const panel = screen.getByRole("heading", { name: goalsCopy.linkedAreasHeading }).closest("aside") as HTMLElement;
    expect(within(panel).getAllByText("Arkitektur")).toHaveLength(1);
    expect(within(panel).queryByText("Tredje")).toBeNull();
  });
});

describe("goals heading structure (visual-redesign TASK-019)", () => {
  it("keeps a valid heading hierarchy for the loaded goals view", async () => {
    await renderReady({ goals: [goal({ id: "a", title: "Mål" })] });
    expectHeadingStructure(document.body, { ownsPageTitle: false });
  });
});

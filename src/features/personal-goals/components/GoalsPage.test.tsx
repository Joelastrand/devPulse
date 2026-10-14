// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { goalsCopy } from "../copy";
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

const active = `${goalsCopy.editButton}${goalsCopy.completeButton}${goalsCopy.deleteButton}`;
const done = `${goalsCopy.editButton}${goalsCopy.reopenButton}${goalsCopy.deleteButton}`;

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
    expect(document.querySelector("details")).toBeNull();
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

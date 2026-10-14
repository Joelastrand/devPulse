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
const deleteGoalMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../client/goals-gateway", () => ({
  fetchGoals: fetchGoalsMock,
  createGoal: createGoalMock,
  updateGoal: updateGoalMock,
  deleteGoal: deleteGoalMock,
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

function listing(overrides: Partial<GoalListResponse> = {}): { status: "ok"; response: GoalListResponse } {
  return {
    status: "ok",
    response: { goals: [], recoveryItems: [], truncated: false, skillOptions: [], skillOptionsTruncated: false, ...overrides },
  };
}

async function renderReady(overrides: Partial<GoalListResponse> = {}) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchGoalsMock.mockResolvedValue(listing(overrides));
  render(<GoalsPage />);
  await screen.findByText(goalsCopy.privacyNotice);
}

const ok = { status: "ok" };
const unconfirmed = { status: "error", error: "unconfirmed" };
const deleteButton = (title: string) => screen.getByRole("button", { name: goalsCopy.deleteButtonName(title) });
const recoveryDelete = (index: number, total: number) =>
  screen.getByRole("button", { name: goalsCopy.recoveryDeleteButtonName(index, total) });
const confirmButton = () => screen.getByRole("button", { name: goalsCopy.deleteConfirmButton });
const cancelButton = () => screen.getByRole("button", { name: goalsCopy.cancelButton });

describe("GoalsPage delete: valid goals", () => {
  it("opens a confirmation naming the goal, permanence and irreversibility; the first click sends no DELETE", async () => {
    await renderReady({ goals: [goal({ id: "secret-id" }), goal({ id: "g2", title: "Andre" })] });
    await userEvent.click(deleteButton("Lær Rust"));
    expect(deleteGoalMock).not.toHaveBeenCalled();
    const group = screen.getByRole("group", { name: goalsCopy.deleteConfirmGoal("Lær Rust") });
    expect(group.textContent).toContain("permanent");
    expect(group.textContent).toContain("ikke angres");
    expect(within(group).getByRole("button", { name: "Slett permanent" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Avbryt" })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe(goalsCopy.deleteConfirmGoal("Lær Rust"));
    expect(document.body.textContent).not.toContain("secret-id");
    // The other goal keeps its actions; only one confirmation exists.
    expect(screen.getByRole("button", { name: goalsCopy.deleteButtonName("Andre") })).toBeTruthy();
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });

  it("Avbryt sends no DELETE, closes the confirmation and returns focus to the delete control", async () => {
    await renderReady({ goals: [goal()] });
    await userEvent.click(deleteButton("Lær Rust"));
    await userEvent.click(cancelButton());
    expect(deleteGoalMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.activeElement).toBe(deleteButton("Lær Rust"));
  });

  it("confirming sends one DELETE for that goal, then refetches the canonical GET and shows its truth", async () => {
    await renderReady({ goals: [goal(), goal({ id: "g2", title: "Andre" })], truncated: true });
    deleteGoalMock.mockResolvedValue(ok);
    fetchGoalsMock.mockResolvedValue(listing({ goals: [goal({ id: "g2", title: "Andre" })], truncated: false }));
    await userEvent.click(deleteButton("Lær Rust"));
    await userEvent.click(confirmButton());
    await waitFor(() => expect(screen.queryByText("Lær Rust")).toBeNull());
    expect(deleteGoalMock).toHaveBeenCalledTimes(1);
    expect(deleteGoalMock).toHaveBeenCalledWith("a-token", "goal-1");
    expect(fetchGoalsMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Andre")).toBeTruthy();
    // The notice follows the new response, not a local guess.
    expect(screen.queryByText(goalsCopy.truncatedNotice)).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("keeps showing a truncation notice when the refetch still reports truncated", async () => {
    await renderReady({ goals: [goal()], truncated: true });
    deleteGoalMock.mockResolvedValue(ok);
    fetchGoalsMock.mockResolvedValue(listing({ goals: [goal({ id: "g9", title: "Nytt synlig" })], truncated: true }));
    await userEvent.click(deleteButton("Lær Rust"));
    await userEvent.click(confirmButton());
    await screen.findByText("Nytt synlig");
    expect(screen.getByText(goalsCopy.truncatedNotice)).toBeTruthy();
  });

  it("a failed delete keeps the goal and the confirmation, shows an alert that makes no claim either way, and does not retry", async () => {
    await renderReady({ goals: [goal()] });
    deleteGoalMock.mockResolvedValue(unconfirmed);
    await userEvent.click(deleteButton("Lær Rust"));
    await userEvent.click(confirmButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(goalsCopy.deleteFailed);
    expect(alert.textContent).not.toMatch(/unconfirmed|persistence|ikke slettet|ble ikke/i);
    expect(screen.getByText(goalsCopy.deleteConfirmGoal("Lær Rust"))).toBeTruthy();
    expect(deleteGoalMock).toHaveBeenCalledTimes(1);
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);
    // An explicit second confirmation is allowed and sends a second DELETE.
    deleteGoalMock.mockResolvedValue(ok);
    fetchGoalsMock.mockResolvedValue(listing());
    await userEvent.click(confirmButton());
    await waitFor(() => expect(deleteGoalMock).toHaveBeenCalledTimes(2));
  });

  it("a successful delete followed by a failed refetch shows the load error, not a delete failure", async () => {
    await renderReady({ goals: [goal()] });
    deleteGoalMock.mockResolvedValue(ok);
    fetchGoalsMock.mockResolvedValue({ status: "read_failed" });
    await userEvent.click(deleteButton("Lær Rust"));
    await userEvent.click(confirmButton());
    expect((await screen.findByRole("alert")).textContent).toBe(goalsCopy.loadError);
    expect(screen.queryByText(goalsCopy.deleteFailed)).toBeNull();
  });

  it("a 401 moves to the signed-out state and clears the private goals", async () => {
    await renderReady({ goals: [goal()] });
    deleteGoalMock.mockResolvedValue({ status: "unauthenticated" });
    await userEvent.click(deleteButton("Lær Rust"));
    await userEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByRole("link", { name: "Logg inn" })).toBeTruthy());
    expect(screen.queryByText("Lær Rust")).toBeNull();
  });

  it("while a delete is pending the confirmation cannot be confirmed again or cancelled", async () => {
    await renderReady({ goals: [goal()] });
    deleteGoalMock.mockReturnValue(new Promise(() => {}));
    await userEvent.click(deleteButton("Lær Rust"));
    await userEvent.click(confirmButton());
    const busy = await screen.findByRole("button", { name: goalsCopy.deleteConfirmPending });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect((cancelButton() as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(busy);
    expect(deleteGoalMock).toHaveBeenCalledTimes(1);
  });

  it("a second confirmation replaces the first, and a goal being edited offers no delete control", async () => {
    await renderReady({ goals: [goal(), goal({ id: "g2", title: "Andre" })] });
    await userEvent.click(deleteButton("Lær Rust"));
    await userEvent.click(deleteButton("Andre"));
    // Opening a confirmation for another goal replaces the first one.
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.getByText(goalsCopy.deleteConfirmGoal("Andre"))).toBeTruthy();
    await userEvent.click(cancelButton());
    await userEvent.click(screen.getByRole("button", { name: goalsCopy.editButtonName("Lær Rust") }));
    const item = screen.getByRole("heading", { level: 3, name: goalsCopy.editHeading }).closest("li") as HTMLElement;
    expect(within(item).queryByRole("button", { name: /slett/i })).toBeNull();
  });

  it("a delete button is disabled while a Complete for the same goal is pending", async () => {
    await renderReady({ goals: [goal()] });
    updateGoalMock.mockReturnValue(new Promise(() => {}));
    await userEvent.click(screen.getByRole("button", { name: goalsCopy.completeButtonName("Lær Rust") }));
    expect((deleteButton("Lær Rust") as HTMLButtonElement).disabled).toBe(true);
  });

  it("deletes a completed goal through the same confirmation", async () => {
    await renderReady({ goals: [goal({ id: "done", title: "Ferdig", status: "completed", completedAt: "2026-02-01T00:00:00.000Z" })] });
    deleteGoalMock.mockResolvedValue(ok);
    fetchGoalsMock.mockResolvedValue(listing());
    await userEvent.click(screen.getByText(goalsCopy.completedSummary(1)));
    await userEvent.click(deleteButton("Ferdig"));
    await userEvent.click(confirmButton());
    await waitFor(() => expect(deleteGoalMock).toHaveBeenCalledWith("a-token", "done"));
    await screen.findByText(goalsCopy.empty);
  });
});

describe("GoalsPage delete: recovery items", () => {
  const items = [{ goalId: "raw-id-a" }, { goalId: "raw-id/b" }, { goalId: "raw-id-c" }];

  it("renders neutral items with exactly one uniquely named delete action each, even with no goals, and never the id", async () => {
    await renderReady({ recoveryItems: items });
    expect(screen.getByText(goalsCopy.recoveryNotice(3))).toBeTruthy();
    expect(screen.queryByText(goalsCopy.empty)).toBeNull();
    const region = screen.getByRole("heading", { name: goalsCopy.recoveryHeading }).closest("section") as HTMLElement;
    const buttons = within(region).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Slett lagret mål som ikke kan vises (1 av 3)",
      "Slett lagret mål som ikke kan vises (2 av 3)",
      "Slett lagret mål som ikke kan vises (3 av 3)",
    ]);
    expect(within(region).queryByRole("button", { name: /rediger|fullfør|åpne|reparer/i })).toBeNull();
    expect(region.querySelector("input, select, textarea, form, a")).toBeNull();
    expect(document.body.innerHTML).not.toContain("raw-id");
  });

  it("the first click only opens a confirmation without a title; Avbryt sends nothing and restores focus", async () => {
    await renderReady({ recoveryItems: items });
    await userEvent.click(recoveryDelete(2, 3));
    expect(deleteGoalMock).not.toHaveBeenCalled();
    const group = screen.getByRole("group", { name: goalsCopy.deleteConfirmRecovery });
    expect(group.textContent).toContain("permanent");
    expect(group.textContent).toContain("ikke angres");
    expect(document.body.innerHTML).not.toContain("raw-id");
    await userEvent.click(cancelButton());
    expect(deleteGoalMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(recoveryDelete(2, 3));
  });

  it("confirming sends one DELETE with the encoded id path source, then refetches; the returned list drives the UI (draining)", async () => {
    await renderReady({ recoveryItems: [{ goalId: "raw-id/b" }], truncated: true });
    deleteGoalMock.mockResolvedValue(ok);
    // The refetch exposes a different item that was previously outside the window.
    fetchGoalsMock.mockResolvedValue(listing({ recoveryItems: [{ goalId: "raw-id-next" }], truncated: false }));
    await userEvent.click(recoveryDelete(1, 1));
    await userEvent.click(confirmButton());
    await waitFor(() => expect(deleteGoalMock).toHaveBeenCalledWith("a-token", "raw-id/b"));
    await waitFor(() => expect(screen.getByText(goalsCopy.recoveryNotice(1))).toBeTruthy());
    expect(screen.queryByRole("group")).toBeNull();
    expect(recoveryDelete(1, 1)).toBeTruthy();
    expect(fetchGoalsMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(goalsCopy.truncatedNotice)).toBeNull();
    expect(document.body.innerHTML).not.toContain("raw-id");
  });

  it("when the last recovery item is deleted the empty state follows the refetched response", async () => {
    await renderReady({ recoveryItems: [{ goalId: "only" }] });
    deleteGoalMock.mockResolvedValue(ok);
    fetchGoalsMock.mockResolvedValue(listing());
    await userEvent.click(recoveryDelete(1, 1));
    await userEvent.click(confirmButton());
    await screen.findByText(goalsCopy.empty);
  });

  it("a failed recovery delete keeps the item and its notice, with an alert and no optimistic removal", async () => {
    await renderReady({ recoveryItems: items });
    deleteGoalMock.mockResolvedValue(unconfirmed);
    await userEvent.click(recoveryDelete(1, 3));
    await userEvent.click(confirmButton());
    expect((await screen.findByRole("alert")).textContent).toBe(goalsCopy.deleteFailed);
    expect(screen.getByText(goalsCopy.recoveryNotice(3))).toBeTruthy();
    expect(screen.getByText(goalsCopy.recoveryItemLabel(1, 3))).toBeTruthy();
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);
    expect(document.body.innerHTML).not.toContain("raw-id");
  });

  it("a 401 on a recovery delete moves to the signed-out state", async () => {
    await renderReady({ recoveryItems: items });
    deleteGoalMock.mockResolvedValue({ status: "unauthenticated" });
    await userEvent.click(recoveryDelete(1, 3));
    await userEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByRole("link", { name: "Logg inn" })).toBeTruthy());
    expect(screen.queryByText(goalsCopy.recoveryNotice(3))).toBeNull();
  });

  it("a duplicate confirm while pending sends one DELETE", async () => {
    await renderReady({ recoveryItems: items });
    deleteGoalMock.mockReturnValue(new Promise(() => {}));
    await userEvent.click(recoveryDelete(1, 3));
    await userEvent.click(confirmButton());
    await userEvent.click(await screen.findByRole("button", { name: goalsCopy.deleteConfirmPending }));
    expect(deleteGoalMock).toHaveBeenCalledTimes(1);
  });

  it("goal-limit scenario: after a recovery item is deleted and the GET is refetched, creating works again", async () => {
    await renderReady({ recoveryItems: [{ goalId: "raw-id-limit" }] });
    // 1. Creation is refused at the cap, with the form content preserved.
    createGoalMock.mockResolvedValueOnce({ status: "error", error: "goal_limit" });
    await userEvent.click(screen.getByRole("button", { name: goalsCopy.createButton }));
    const region = document.getElementById("create-goal-region") as HTMLElement;
    await userEvent.type(within(region).getByLabelText(goalsCopy.titleLabel), "Lær Go");
    await userEvent.click(within(region).getByRole("button", { name: goalsCopy.createSubmit }));
    expect((await within(region).findByRole("alert")).textContent).toBe(goalsCopy.goalLimit);
    expect((within(region).getByLabelText(goalsCopy.titleLabel) as HTMLInputElement).value).toBe("Lær Go");

    // 2. The recovery item is deleted; the canonical GET shows it gone.
    deleteGoalMock.mockResolvedValue(ok);
    fetchGoalsMock.mockResolvedValue(listing());
    await userEvent.click(recoveryDelete(1, 1));
    await userEvent.click(confirmButton());
    await screen.findByText(goalsCopy.empty);

    // 3. The server now accepts the create (the page infers nothing about capacity itself).
    createGoalMock.mockResolvedValueOnce({ status: "ok", goal: goal({ title: "Lær Go" }) });
    fetchGoalsMock.mockResolvedValue(listing({ goals: [goal({ title: "Lær Go" })] }));
    // The create form stayed open with its content, so the same submit can simply be repeated.
    const reopened = document.getElementById("create-goal-region") as HTMLElement;
    expect((within(reopened).getByLabelText(goalsCopy.titleLabel) as HTMLInputElement).value).toBe("Lær Go");
    await userEvent.click(within(reopened).getByRole("button", { name: goalsCopy.createSubmit }));
    await screen.findByText("Lær Go");
    expect(createGoalMock).toHaveBeenCalledTimes(2);
    expect(createGoalMock).toHaveBeenLastCalledWith("a-token", { title: "Lær Go" });
  });

  it("creation stays available beside recovery items and sends no delete", async () => {
    await renderReady({ recoveryItems: items });
    expect(screen.getByRole("button", { name: goalsCopy.createButton })).toBeTruthy();
    expect(deleteGoalMock).not.toHaveBeenCalled();
  });
});

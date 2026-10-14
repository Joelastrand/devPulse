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

const ok = (g: GoalDto) => ({ status: "ok", goal: g });
const failure = (error: string) => ({ status: "error", error });
const options = [
  { treeId: "t-arch", name: "Arkitektur" },
  { treeId: "t-test", name: "Testing" },
];

async function openCreate() {
  await userEvent.click(screen.getByRole("button", { name: goalsCopy.createButton }));
  return document.getElementById("create-goal-region") as HTMLElement;
}

describe("GoalsPage create", () => {
  it("renders a native form with Tittel, Ferdighetsområde (Ingen first, options only) and Måldato, and nothing else", async () => {
    await renderReady({ skillOptions: options });
    const region = await openCreate();
    const form = region.querySelector("form") as HTMLFormElement;
    const title = within(form).getByLabelText(goalsCopy.titleLabel) as HTMLInputElement;
    expect(title.required).toBe(true);
    const select = within(form).getByLabelText(goalsCopy.areaLabel) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ["", goalsCopy.areaNone],
      ["t-arch", "Arkitektur"],
      ["t-test", "Testing"],
    ]);
    const date = within(form).getByLabelText(goalsCopy.targetDateLabel) as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.min).toBe("");
    expect(form.querySelectorAll("input, select, textarea")).toHaveLength(3);
    expect(form.textContent).not.toContain("t-arch");
  });

  it("shows an inline message and sends nothing when the title is blank", async () => {
    await renderReady();
    const region = await openCreate();
    await userEvent.type(within(region).getByLabelText(goalsCopy.titleLabel), "   ");
    await userEvent.click(within(region).getByRole("button", { name: goalsCopy.createSubmit }));
    expect(within(region).getByRole("alert").textContent).toBe(goalsCopy.titleRequired);
    expect(createGoalMock).not.toHaveBeenCalled();
  });

  it("sends only the title when optional fields are empty, then closes the form and refetches the canonical GET", async () => {
    await renderReady();
    createGoalMock.mockResolvedValue(ok(goal()));
    fetchGoalsMock.mockResolvedValue(listing({ goals: [goal({ title: "Ny" })], skillOptions: options, skillOptionsTruncated: true }));
    const region = await openCreate();
    await userEvent.type(within(region).getByLabelText(goalsCopy.titleLabel), "Ny");
    await userEvent.click(within(region).getByRole("button", { name: goalsCopy.createSubmit }));

    await waitFor(() => expect(screen.getByText("Ny")).toBeTruthy());
    expect(createGoalMock).toHaveBeenCalledTimes(1);
    expect(createGoalMock).toHaveBeenCalledWith("a-token", { title: "Ny" });
    expect(fetchGoalsMock).toHaveBeenCalledTimes(2);
    expect(document.getElementById("create-goal-region")?.hidden).toBe(true);
    // The refetched read model (options, truncation notice) is kept.
    expect(screen.getByText(goalsCopy.skillOptionsTruncatedNotice)).toBeTruthy();
    // Creation stays reachable once a goal exists.
    expect(screen.getByRole("button", { name: goalsCopy.createButton })).toBeTruthy();
  });

  it("sends title, treeId and targetDate (a past date is accepted) and nothing else", async () => {
    await renderReady({ skillOptions: options });
    createGoalMock.mockResolvedValue(ok(goal()));
    const region = await openCreate();
    await userEvent.type(within(region).getByLabelText(goalsCopy.titleLabel), "Lær testing");
    await userEvent.selectOptions(within(region).getByLabelText(goalsCopy.areaLabel), "Testing");
    await userEvent.type(within(region).getByLabelText(goalsCopy.targetDateLabel), "2020-01-31");
    await userEvent.click(within(region).getByRole("button", { name: goalsCopy.createSubmit }));
    await waitFor(() => expect(createGoalMock).toHaveBeenCalledTimes(1));
    expect(createGoalMock).toHaveBeenCalledWith("a-token", {
      title: "Lær testing",
      treeId: "t-test",
      targetDate: "2020-01-31",
    });
  });

  it.each([
    ["invalid_title", goalsCopy.invalidTitle],
    ["invalid_target_date", goalsCopy.invalidTargetDate],
    ["skill_not_found", goalsCopy.skillNotFound],
    ["goal_limit", goalsCopy.goalLimit],
    ["persistence_failed", goalsCopy.outcomeUnknown],
    ["unknown", goalsCopy.outcomeUnknown],
  ])("create error %s is an alert with the form content preserved and no raw discriminator", async (error, message) => {
    await renderReady({ skillOptions: options });
    createGoalMock.mockResolvedValue(failure(error));
    const region = await openCreate();
    await userEvent.type(within(region).getByLabelText(goalsCopy.titleLabel), "Behold meg");
    await userEvent.selectOptions(within(region).getByLabelText(goalsCopy.areaLabel), "Arkitektur");
    await userEvent.type(within(region).getByLabelText(goalsCopy.targetDateLabel), "2030-05-05");
    await userEvent.click(within(region).getByRole("button", { name: goalsCopy.createSubmit }));

    expect((await within(region).findByRole("alert")).textContent).toBe(message);
    expect((within(region).getByLabelText(goalsCopy.titleLabel) as HTMLInputElement).value).toBe("Behold meg");
    expect((within(region).getByLabelText(goalsCopy.areaLabel) as HTMLSelectElement).value).toBe("t-arch");
    expect((within(region).getByLabelText(goalsCopy.targetDateLabel) as HTMLInputElement).value).toBe("2030-05-05");
    expect(document.body.textContent).not.toContain(error);
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);
  });

  it("the goal-limit message states no count and the unknown-outcome message never says nothing was saved", () => {
    expect(goalsCopy.goalLimit).not.toMatch(/\d/);
    expect(goalsCopy.outcomeUnknown).not.toMatch(/ikke (ble )?lagret|ingenting|trygt/i);
  });

  it("does not submit twice while a create is pending and keeps the form data", async () => {
    await renderReady();
    createGoalMock.mockReturnValue(new Promise(() => {}));
    const region = await openCreate();
    await userEvent.type(within(region).getByLabelText(goalsCopy.titleLabel), "Dobbel");
    const submit = within(region).getByRole("button", { name: goalsCopy.createSubmit });
    await userEvent.click(submit);
    const busy = await within(region).findByRole("button", { name: goalsCopy.createSubmitting });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(busy);
    expect(createGoalMock).toHaveBeenCalledTimes(1);
    expect((within(region).getByLabelText(goalsCopy.titleLabel) as HTMLInputElement).value).toBe("Dobbel");
  });

  it("moves to the signed-out state on 401 and shows no goals", async () => {
    await renderReady({ goals: [goal()] });
    createGoalMock.mockResolvedValue({ status: "unauthenticated" });
    const region = await openCreate();
    await userEvent.type(within(region).getByLabelText(goalsCopy.titleLabel), "x");
    await userEvent.click(within(region).getByRole("button", { name: goalsCopy.createSubmit }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Logg inn" })).toBeTruthy());
    expect(screen.queryByText("Lær Rust")).toBeNull();
  });

  it("opening an edit form closes the create form (one form at a time)", async () => {
    await renderReady({ goals: [goal()] });
    await openCreate();
    await userEvent.click(screen.getByRole("button", { name: goalsCopy.editButtonName("Lær Rust") }));
    expect(document.getElementById("create-goal-region")?.hidden).toBe(true);
    expect(document.querySelectorAll("form")).toHaveLength(1);
  });
});

describe("GoalsPage edit", () => {
  async function openEdit(g: GoalDto, overrides: Partial<GoalListResponse> = {}) {
    await renderReady({ goals: [g], skillOptions: options, ...overrides });
    await userEvent.click(screen.getByRole("button", { name: goalsCopy.editButtonName(g.title) }));
    const heading = screen.getByRole("heading", { level: 3, name: goalsCopy.editHeading });
    expect(document.activeElement).toBe(heading);
    return heading.closest("li") as HTMLElement;
  }
  const save = (item: HTMLElement) => userEvent.click(within(item).getByRole("button", { name: goalsCopy.editSubmit }));

  it("prefills title, linked area and date, and sends nothing when nothing changed", async () => {
    const item = await openEdit(goal({ treeId: "t-arch", areaName: "Arkitektur", targetDate: "2026-03-01" }));
    expect((within(item).getByLabelText(goalsCopy.titleLabel) as HTMLInputElement).value).toBe("Lær Rust");
    expect((within(item).getByLabelText(goalsCopy.areaLabel) as HTMLSelectElement).value).toBe("t-arch");
    expect((within(item).getByLabelText(goalsCopy.targetDateLabel) as HTMLInputElement).value).toBe("2026-03-01");
    await save(item);
    expect(updateGoalMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { level: 3, name: goalsCopy.editHeading })).toBeNull();
  });

  it("sends only the changed title; treeId and targetDate stay absent", async () => {
    const item = await openEdit(goal({ treeId: "t-arch", areaName: "Arkitektur", targetDate: "2026-03-01" }));
    updateGoalMock.mockResolvedValue(ok(goal()));
    await userEvent.type(within(item).getByLabelText(goalsCopy.titleLabel), " 2");
    await save(item);
    await waitFor(() => expect(updateGoalMock).toHaveBeenCalledTimes(1));
    expect(updateGoalMock).toHaveBeenCalledWith("a-token", "goal-1", { title: "Lær Rust 2" });
    await waitFor(() => expect(fetchGoalsMock).toHaveBeenCalledTimes(2));
  });

  it("sends a changed date as a string and a removed date as null", async () => {
    let item = await openEdit(goal({ targetDate: "2026-03-01" }));
    updateGoalMock.mockResolvedValue(ok(goal()));
    const date = within(item).getByLabelText(goalsCopy.targetDateLabel);
    await userEvent.clear(date);
    await userEvent.type(date, "2019-12-24");
    await save(item);
    await waitFor(() => expect(updateGoalMock).toHaveBeenLastCalledWith("a-token", "goal-1", { targetDate: "2019-12-24" }));

    cleanup();
    vi.clearAllMocks();
    item = await openEdit(goal({ targetDate: "2026-03-01" }));
    updateGoalMock.mockResolvedValue(ok(goal()));
    await userEvent.clear(within(item).getByLabelText(goalsCopy.targetDateLabel));
    await save(item);
    await waitFor(() => expect(updateGoalMock).toHaveBeenLastCalledWith("a-token", "goal-1", { targetDate: null }));
  });

  it("sends a chosen area as a treeId and Ingen as null", async () => {
    let item = await openEdit(goal());
    updateGoalMock.mockResolvedValue(ok(goal()));
    await userEvent.selectOptions(within(item).getByLabelText(goalsCopy.areaLabel), "Testing");
    await save(item);
    await waitFor(() => expect(updateGoalMock).toHaveBeenLastCalledWith("a-token", "goal-1", { treeId: "t-test" }));

    cleanup();
    vi.clearAllMocks();
    item = await openEdit(goal({ treeId: "t-arch", areaName: "Arkitektur" }));
    updateGoalMock.mockResolvedValue(ok(goal()));
    await userEvent.selectOptions(within(item).getByLabelText(goalsCopy.areaLabel), goalsCopy.areaNone);
    await save(item);
    await waitFor(() => expect(updateGoalMock).toHaveBeenLastCalledWith("a-token", "goal-1", { treeId: null }));
  });

  it("keeps a linked tree outside the option window selectable and preselected, and does not unlink it", async () => {
    const item = await openEdit(goal({ treeId: "t-far", areaName: "Utenfor vinduet" }));
    const select = within(item).getByLabelText(goalsCopy.areaLabel) as HTMLSelectElement;
    expect(select.value).toBe("t-far");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      goalsCopy.areaNone,
      "Utenfor vinduet",
      "Arkitektur",
      "Testing",
    ]);
    updateGoalMock.mockResolvedValue(ok(goal()));
    await userEvent.type(within(item).getByLabelText(goalsCopy.titleLabel), "!");
    await save(item);
    await waitFor(() => expect(updateGoalMock).toHaveBeenCalledTimes(1));
    expect(updateGoalMock.mock.calls[0]?.[2]).toEqual({ title: "Lær Rust!" });
  });

  it("unavailable linked area: edit stays possible, title-only edits omit treeId, Ingen sends null", async () => {
    const unavailable = goal({ treeId: "t-gone", areaName: null, areaAvailable: false });
    let item = await openEdit(unavailable);
    const select = within(item).getByLabelText(goalsCopy.areaLabel) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      goalsCopy.areaNone,
      goalsCopy.areaUnavailable,
      "Arkitektur",
      "Testing",
    ]);
    expect(select.selectedOptions[0]?.textContent).toBe(goalsCopy.areaUnavailable);
    updateGoalMock.mockResolvedValue(ok(goal()));
    await userEvent.type(within(item).getByLabelText(goalsCopy.titleLabel), "?");
    await save(item);
    await waitFor(() => expect(updateGoalMock).toHaveBeenCalledTimes(1));
    expect(updateGoalMock.mock.calls[0]?.[2]).toEqual({ title: "Lær Rust?" });
    expect(Object.keys(updateGoalMock.mock.calls[0]?.[2] as object)).not.toContain("treeId");

    cleanup();
    vi.clearAllMocks();
    item = await openEdit(unavailable);
    updateGoalMock.mockResolvedValue(ok(goal()));
    await userEvent.selectOptions(within(item).getByLabelText(goalsCopy.areaLabel), goalsCopy.areaNone);
    await save(item);
    await waitFor(() => expect(updateGoalMock).toHaveBeenCalledTimes(1));
    expect(updateGoalMock.mock.calls[0]?.[2]).toEqual({ treeId: null });
    expect(document.body.textContent).not.toContain("t-gone");
  });

  it("cancel closes the edit form without a request and returns focus to the edit control", async () => {
    const item = await openEdit(goal());
    await userEvent.type(within(item).getByLabelText(goalsCopy.titleLabel), "x");
    await userEvent.click(within(item).getByRole("button", { name: goalsCopy.cancelButton }));
    expect(updateGoalMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { level: 3, name: goalsCopy.editHeading })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: goalsCopy.editButtonName("Lær Rust") }));
  });

  it.each([
    ["invalid_title", goalsCopy.invalidTitle],
    ["invalid_target_date", goalsCopy.invalidTargetDate],
    ["skill_not_found", goalsCopy.skillNotFound],
    ["goal_not_found", goalsCopy.goalNotFound],
    ["clock_regressed", goalsCopy.serverFailure],
    ["persistence_failed", goalsCopy.outcomeUnknown],
  ])("edit error %s is an alert, keeps the input and does not retry or refetch", async (error, message) => {
    const item = await openEdit(goal());
    updateGoalMock.mockResolvedValue(failure(error));
    await userEvent.type(within(item).getByLabelText(goalsCopy.titleLabel), " ny");
    await userEvent.selectOptions(within(item).getByLabelText(goalsCopy.areaLabel), "Testing");
    await save(item);
    expect((await within(item).findByRole("alert")).textContent).toBe(message);
    expect((within(item).getByLabelText(goalsCopy.titleLabel) as HTMLInputElement).value).toBe("Lær Rust ny");
    expect((within(item).getByLabelText(goalsCopy.areaLabel) as HTMLSelectElement).value).toBe("t-test");
    expect(updateGoalMock).toHaveBeenCalledTimes(1);
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(error);
  });

  it("does not save twice while an edit is pending", async () => {
    const item = await openEdit(goal());
    updateGoalMock.mockReturnValue(new Promise(() => {}));
    await userEvent.type(within(item).getByLabelText(goalsCopy.titleLabel), "!");
    await save(item);
    const busy = await within(item).findByRole("button", { name: goalsCopy.editSubmitting });
    await userEvent.click(busy);
    expect(updateGoalMock).toHaveBeenCalledTimes(1);
  });
});

describe("GoalsPage complete and reopen", () => {
  const completedGoal = goal({ id: "done-1", title: "Ferdig", status: "completed", completedAt: "2026-02-01T00:00:00.000Z" });

  it("Complete sends exactly status completed and the goal moves to the completed group after the refetch", async () => {
    await renderReady({ goals: [goal()] });
    updateGoalMock.mockResolvedValue(ok(completedGoal));
    fetchGoalsMock.mockResolvedValue(listing({ goals: [goal({ status: "completed", completedAt: "2026-02-03T00:00:00.000Z" })] }));
    await userEvent.click(screen.getByRole("button", { name: goalsCopy.completeButtonName("Lær Rust") }));
    await waitFor(() => expect(screen.getByText(goalsCopy.completedSummary(1))).toBeTruthy());
    expect(updateGoalMock).toHaveBeenCalledWith("a-token", "goal-1", { status: "completed" });
    expect(screen.getByText(goalsCopy.noActiveGoals)).toBeTruthy();
  });

  it("Reopen sends exactly status active and the goal returns to the active list", async () => {
    await renderReady({ goals: [completedGoal] });
    updateGoalMock.mockResolvedValue(ok(goal({ id: "done-1", title: "Ferdig" })));
    fetchGoalsMock.mockResolvedValue(listing({ goals: [goal({ id: "done-1", title: "Ferdig" })] }));
    const details = screen.getByText(goalsCopy.completedSummary(1)).closest("details") as HTMLElement;
    await userEvent.click(within(details).getByText(goalsCopy.completedSummary(1)));
    await userEvent.click(within(details).getByRole("button", { name: goalsCopy.reopenButtonName("Ferdig") }));
    await waitFor(() => expect(document.querySelector("details")).toBeNull());
    expect(updateGoalMock).toHaveBeenCalledWith("a-token", "done-1", { status: "active" });
    expect(screen.getByText(goalsCopy.statusActive)).toBeTruthy();
  });

  it("guards a pending lifecycle request against repeated clicks without locking other goals", async () => {
    await renderReady({ goals: [goal(), goal({ id: "goal-2", title: "Andre" })] });
    updateGoalMock.mockReturnValue(new Promise(() => {}));
    const first = screen.getByRole("button", { name: goalsCopy.completeButtonName("Lær Rust") });
    await userEvent.click(first);
    await userEvent.click(first);
    expect(updateGoalMock).toHaveBeenCalledTimes(1);
    expect((first as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: goalsCopy.completeButtonName("Andre") }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ["goal_not_found", goalsCopy.goalNotFound],
    ["clock_regressed", goalsCopy.serverFailure],
    ["persistence_failed", goalsCopy.outcomeUnknown],
  ])("lifecycle error %s shows a scoped alert, does not retry or refetch and re-enables the button", async (error, message) => {
    await renderReady({ goals: [goal()] });
    updateGoalMock.mockResolvedValue(failure(error));
    await userEvent.click(screen.getByRole("button", { name: goalsCopy.completeButtonName("Lær Rust") }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(updateGoalMock).toHaveBeenCalledTimes(1);
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: goalsCopy.completeButtonName("Lær Rust") }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a 401 during a lifecycle change moves to the signed-out state", async () => {
    await renderReady({ goals: [goal()] });
    updateGoalMock.mockResolvedValue({ status: "unauthenticated" });
    await userEvent.click(screen.getByRole("button", { name: goalsCopy.completeButtonName("Lær Rust") }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Logg inn" })).toBeTruthy());
    expect(screen.queryByText("Lær Rust")).toBeNull();
  });
});

describe("GoalsPage mutation UI boundaries", () => {
  it("renders no owner, status-select, overdue or score controls and never shows goal ids", async () => {
    await renderReady({ goals: [goal({ id: "secret-goal-id" })], recoveryItems: [{ goalId: "secret-recovery-id" }], skillOptions: options });
    await userEvent.click(screen.getByRole("button", { name: goalsCopy.createButton }));
    expect(document.body.textContent).not.toMatch(/secret-(goal|recovery)-id/);
    expect(document.body.textContent).not.toMatch(/forsinket|overskredet|poeng|score|prosent|%/i);
    expect(document.querySelectorAll("select")).toHaveLength(1);
    expect(document.querySelector("form [name=uid], form [name=status], form [name=ownerUid]")).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { goalsCopy } from "../copy";
import type { GoalDto, GoalListResponse } from "../domain/goal";

const observeIdTokenMock = vi.fn();
const fetchGoalsMock = vi.fn();
const createGoalMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../client/goals-gateway", () => ({
  fetchGoals: fetchGoalsMock,
  createGoal: createGoalMock,
  updateGoal: vi.fn(),
}));

const { GoalsPage } = await import("./GoalsPage");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const options = [
  { treeId: "t-arch", name: "Arkitektur" },
  { treeId: "t-test", name: "Testing" },
];

function listing(overrides: Partial<GoalListResponse> = {}): { status: "ok"; response: GoalListResponse } {
  return {
    status: "ok",
    response: { goals: [], recoveryItems: [], truncated: false, skillOptions: options, skillOptionsTruncated: false, ...overrides },
  };
}

const createdGoal: GoalDto = {
  id: "goal-1",
  title: "Ny",
  status: "active",
  treeId: null,
  areaName: null,
  areaAvailable: true,
  targetDate: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
};

async function renderGoals(props: { initialTreeId?: string } = {}) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchGoalsMock.mockResolvedValue(listing());
  render(<GoalsPage {...props} />);
  await screen.findByText(goalsCopy.privacyNotice);
}

function createRegion(): HTMLElement {
  return document.getElementById("create-goal-region") as HTMLElement;
}

describe("GoalsPage create prefill (role-profiles 'Opprett mål', PG-1, PG-11)", () => {
  it("opens the create form with the requested tree preselected and submits only the title and treeId", async () => {
    createGoalMock.mockResolvedValue({ status: "ok", goal: createdGoal });
    await renderGoals({ initialTreeId: "t-test" });

    const region = createRegion();
    expect(region.hidden).toBe(false);
    const select = within(region).getByLabelText(goalsCopy.areaLabel) as HTMLSelectElement;
    expect(select.value).toBe("t-test");

    await userEvent.type(within(region).getByLabelText(goalsCopy.titleLabel), "Ny");
    await userEvent.click(within(region).getByRole("button", { name: goalsCopy.createSubmit }));

    await waitFor(() => expect(createGoalMock).toHaveBeenCalledTimes(1));
    expect(createGoalMock).toHaveBeenCalledWith("a-token", { title: "Ny", treeId: "t-test" });
  });

  it("starts with no area when the requested tree is not one of the bounded options, and submits only the title", async () => {
    createGoalMock.mockResolvedValue({ status: "ok", goal: createdGoal });
    await renderGoals({ initialTreeId: "t-gone" });

    const region = createRegion();
    expect((within(region).getByLabelText(goalsCopy.areaLabel) as HTMLSelectElement).value).toBe("");

    await userEvent.type(within(region).getByLabelText(goalsCopy.titleLabel), "Ny");
    await userEvent.click(within(region).getByRole("button", { name: goalsCopy.createSubmit }));

    await waitFor(() => expect(createGoalMock).toHaveBeenCalledTimes(1));
    expect(createGoalMock).toHaveBeenCalledWith("a-token", { title: "Ny" });
  });

  it("keeps the create form closed without a treeId, as before", async () => {
    await renderGoals();

    expect(createRegion().hidden).toBe(true);
  });

  it("opening with a treeId and cancelling issues no create request and no extra read", async () => {
    await renderGoals({ initialTreeId: "t-test" });

    await userEvent.click(within(createRegion()).getByRole("button", { name: goalsCopy.cancelButton }));

    expect(createRegion().hidden).toBe(true);
    expect(createGoalMock).not.toHaveBeenCalled();
    expect(fetchGoalsMock).toHaveBeenCalledTimes(1);
  });
});

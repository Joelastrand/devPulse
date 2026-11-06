// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetencePlanPageData } from "../client/use-competence-plans";

const hook = vi.hoisted(() => ({
  data: { phase: "loading" } as unknown,
  save: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("../client/use-competence-plans", () => ({
  useCompetencePlans: () => ({ data: hook.data, save: hook.save, reload: hook.reload }),
}));

import { CompetencePlanSection } from "./CompetencePlanSection";

const TREE_B = "tree-testing";
const TREE_C = "tree-observability";

function loaded(overrides: Partial<Extract<CompetencePlanPageData, { phase: "loaded" }>> = {}): CompetencePlanPageData {
  return {
    phase: "loaded",
    canEdit: false,
    truncated: false,
    legacyItems: [],
    legacyFailed: false,
    areas: [
      { treeId: TREE_B, name: "Testautomatisering", status: "active" },
      { treeId: TREE_C, name: "Observerbarhet", status: "active" },
    ],
    plans: [
      {
        treeId: TREE_B,
        targetStage: 3,
        priority: "high",
        archived: false,
        progress: { completed: 2, total: 5 },
        milestones: [
          { id: "11111111-1111-4111-8111-111111111111", title: "Dekning i hovedflyt", targetDate: "2026-12-01", status: "completed" },
          { id: "22222222-2222-4222-8222-222222222222", title: "Ende-til-ende-tester", targetDate: null, status: "in_progress" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("CompetencePlanSection", () => {
  beforeEach(() => {
    hook.save.mockReset();
    hook.reload.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state while the plan is being read", () => {
    hook.data = { phase: "loading" };
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByRole("status").textContent).toContain("Laster kompetanseplanen");
  });

  it("shows a forbidden error without a retry action", () => {
    hook.data = { phase: "error", reason: "forbidden" };
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByRole("alert").textContent).toContain("Du har ikke tilgang");
    expect(screen.queryByRole("button", { name: "Prøv igjen" })).toBeNull();
  });

  it("offers a retry after a failed read and calls reload", async () => {
    hook.data = { phase: "error", reason: "read_failed" };
    render(<CompetencePlanSection teamId="team-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    expect(hook.reload).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state for a team without plans, and no editing for a member", () => {
    hook.data = loaded({ plans: [], canEdit: false });
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByText("Ingen kompetanseplaner ennå."));
    expect(screen.queryByRole("button", { name: "Ny plan" })).toBeNull();
  });

  it("shows plan progress as completed milestones out of the total, with the target stage label", () => {
    hook.data = loaded();
    render(<CompetencePlanSection teamId="team-1" />);
    const card = screen.getByRole("listitem");
    expect(within(card).getByRole("heading", { name: "Testautomatisering" }));
    expect(within(card).getByText("1 av 2 steg"));
    expect(within(card).getByText("Målnivå: Kan selvstendig"));
    expect(within(card).getByText("Prioritet: Høy"));
    expect(within(card).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
  });

  it("reveals milestone steps and their status text when details are opened", async () => {
    hook.data = loaded();
    render(<CompetencePlanSection teamId="team-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Vis steg" }));
    expect(screen.getByText("Ende-til-ende-tester"));
    expect(screen.getByText("Pågår"));
    expect(screen.getByText("Fullført"));
  });

  it("gives a lead an edit action and a picker for assigned areas without a plan", async () => {
    hook.data = loaded({ canEdit: true });
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByRole("button", { name: "Rediger plan: Testautomatisering" }));
    await userEvent.click(screen.getByRole("button", { name: "Ny plan" }));
    const picker = screen.getByLabelText("Kompetanseområde");
    expect(within(picker).getByRole("option", { name: "Observerbarhet" }));
    expect(within(picker).queryByRole("option", { name: "Testautomatisering" })).toBeNull();
  });

  it("shows existing roadmap competence steps read-only with their recorded status", () => {
    hook.data = loaded({
      canEdit: true,
      plans: [],
      legacyItems: [
        {
          treeId: "tree-security",
          areaName: "Sikkerhet",
          targetNodeId: "node-1",
          targetLabel: "Trusselmodellering",
          targetAvailable: true,
          tracking: { state: "not_tracked" },
          priority: "medium",
          status: "active",
          startDate: null,
          targetDate: null,
          owner: null,
          overdue: false,
          archived: false,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          completedAt: null,
        },
      ],
    });
    render(<CompetencePlanSection teamId="team-1" />);
    const legacy = screen.getByRole("region", { name: "Eksisterende kompetansesteg" });
    expect(within(legacy).getByText("Sikkerhet")).toBeTruthy();
    expect(within(legacy).getByText("Trusselmodellering")).toBeTruthy();
    expect(within(legacy).getByText("Pågår")).toBeTruthy();
    expect(within(legacy).queryByRole("button")).toBeNull();
  });

  it("states that the plan is advisory and that only a lead can edit it, for members", () => {
    hook.data = loaded({ canEdit: false });
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByText("Bare teamleder kan endre kompetanseplanen. Planen er veiledende."));
  });
});

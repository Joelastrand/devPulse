// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompetencePlanPageData } from "../client/use-competence-plans";

const hook = vi.hoisted(() => ({ data: { phase: "loading" } as unknown }));

vi.mock("../client/use-competence-plans", () => ({
  useCompetencePlans: () => ({
    data: hook.data,
    save: vi.fn(),
    saveMilestoneCompletion: vi.fn(),
    reload: vi.fn(),
  }),
}));

import { CompetencePlanSection } from "./CompetencePlanSection";

const PLANNED = "tree-testing";
const UNPLANNED = "tree-observability";

function loaded(overrides: Partial<Extract<CompetencePlanPageData, { phase: "loaded" }>> = {}): CompetencePlanPageData {
  return {
    phase: "loaded",
    canEdit: true,
    truncated: false,
    legacyItems: [],
    legacyFailed: false,
    areas: [
      { treeId: PLANNED, name: "Testautomatisering", status: "active" },
      { treeId: UNPLANNED, name: "Observerbarhet", status: "active" },
    ],
    plans: [{ treeId: PLANNED, targetStage: 3, priority: "high", archived: false, progress: { completed: 0, total: 0 }, milestones: [] }],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("CompetencePlanSection creation entry (Kompetanseplan)", () => {
  it("offers a visible 'Ny kompetanseplan' action to a lead when an unplanned area is assigned", () => {
    hook.data = loaded();
    render(<CompetencePlanSection teamId="team-1" />);

    expect(screen.getByRole("button", { name: "Ny kompetanseplan" })).toBeTruthy();
  });

  it("opens the creation form with the area preselected from Teamkompetanse", async () => {
    hook.data = loaded();
    render(<CompetencePlanSection teamId="team-1" initialAreaTreeId={UNPLANNED} />);

    const picker = screen.getByLabelText("Kompetanseområde") as HTMLSelectElement;
    expect(picker.value).toBe(UNPLANNED);
    expect(screen.getByRole("form", { name: /Observerbarhet/ })).toBeTruthy();
  });

  it("ignores a preselected area that already has a plan, so no duplicate can be started", () => {
    hook.data = loaded();
    render(<CompetencePlanSection teamId="team-1" initialAreaTreeId={PLANNED} />);

    const picker = screen.queryByLabelText("Kompetanseområde") as HTMLSelectElement | null;
    expect(picker === null || picker.value !== PLANNED).toBe(true);
  });

  it("explains missing assigned areas and links a lead to Teamkompetanse, instead of a dead end", () => {
    hook.data = loaded({ areas: [], plans: [] });
    render(<CompetencePlanSection teamId="team-1" />);

    const link = screen.getByRole("link", { name: "Tildel kompetanseområder på Teamkompetanse" });
    expect(link.getAttribute("href")).toBe("/teams/team-1/competence");
  });

  it("does not show the creation action to a member", () => {
    hook.data = loaded({ canEdit: false });
    render(<CompetencePlanSection teamId="team-1" />);

    expect(screen.queryByRole("button", { name: "Ny kompetanseplan" })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
  });
});

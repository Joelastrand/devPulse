// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientCompetencePlan } from "../client/competence-plan-gateway";
import { CompetencePlanOverview } from "./CompetencePlanOverview";

const TREE_A = "tree-a";
const TREE_B = "tree-b";
const NOV_2026 = { year: 2026, month: 11 };
const TODAY = "2026-12-10";

const plans: ClientCompetencePlan[] = [
  {
    treeId: TREE_A,
    targetStage: 3,
    priority: "low",
    archived: false,
    progress: { completed: 1, total: 2 },
    milestones: [
      { id: "a1", title: "Første steg", targetDate: "2026-12-01", status: "completed" },
      { id: "a2", title: "Andre steg", targetDate: "2027-01-15", status: "in_progress" },
    ],
  },
  {
    treeId: TREE_B,
    targetStage: 2,
    priority: "high",
    archived: false,
    progress: { completed: 0, total: 1 },
    milestones: [{ id: "b1", title: "Udatert steg", targetDate: null, status: "planned" }],
  },
];

const names: Record<string, string> = { [TREE_A]: "Testautomatisering", [TREE_B]: "Observerbarhet" };
const nameOf = (treeId: string) => names[treeId] ?? null;

function planWithCompleted(completed: number, total: number): ClientCompetencePlan {
  return {
    treeId: TREE_A,
    targetStage: 3,
    priority: "low",
    archived: false,
    progress: { completed, total },
    milestones: Array.from({ length: total }, (_, index) => ({
      id: `m${index}`,
      title: `Steg ${index + 1}`,
      targetDate: "2026-12-01",
      status: index < completed ? ("completed" as const) : ("planned" as const),
    })),
  };
}

function renderOverview(
  overrides: Partial<Parameters<typeof CompetencePlanOverview>[0]> = {},
) {
  return render(
    <CompetencePlanOverview plans={plans} nameOf={nameOf} start={NOV_2026} today={TODAY} onOpenPlan={() => undefined} {...overrides} />,
  );
}

afterEach(() => cleanup());

describe("CompetencePlanOverview timeline", () => {
  it("switches the timeline between 3 and 6 months with pressed state", async () => {
    renderOverview();
    const six = screen.getByRole("button", { name: "6 måneder" });
    const three = screen.getByRole("button", { name: "3 måneder" });
    expect(six.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(three);
    expect(three.getAttribute("aria-pressed")).toBe("true");
    expect(six.getAttribute("aria-pressed")).toBe("false");
  });

  it("states how far the plan is complete in text, separate from its dates", () => {
    renderOverview();
    const rowA = screen.getByTestId(`timeline-row-${TREE_A}`);
    expect(within(rowA).getByText("Pågår · 1 av 2 steg")).toBeTruthy();
  });

  it("says so when a plan has no dated steps inside the window", () => {
    renderOverview();
    const rowB = screen.getByTestId(`timeline-row-${TREE_B}`);
    expect(within(rowB).getByText("Ingen datoer i dette tidsrommet")).toBeTruthy();
  });

  it("shows no timeline bar and the empty message when no plan has a dated step in the window", () => {
    renderOverview({ plans: [{ ...planWithCompleted(0, 1), milestones: [{ id: "x", title: "Senere", targetDate: "2030-01-01", status: "planned" }] }] });
    expect(screen.queryByRole("progressbar", { name: /Fremdrift i planen/ })).toBeNull();
    expect(screen.getByText("Ingen steg med dato i de valgte månedene.")).toBeTruthy();
  });
});

describe("timeline progress fill", () => {
  function fillWidth(completed: number, total: number): string {
    renderOverview({ plans: [planWithCompleted(completed, total)] });
    const row = screen.getByTestId(`timeline-row-${TREE_A}`);
    const fill = screen.getByTestId(`timeline-fill-${TREE_A}`);
    expect(within(row).getByRole("progressbar")).toBeTruthy();
    return fill.style.width;
  }

  it.each([
    [0, 4, "0%"],
    [1, 4, "25%"],
    [2, 4, "50%"],
    [3, 4, "75%"],
    [4, 4, "100%"],
  ])("fills %i of %i completed steps to exactly %s of the track", (completed, total, width) => {
    cleanup();
    expect(fillWidth(completed, total)).toBe(width);
  });

  it("keeps the bar length independent of how many steps are completed", () => {
    cleanup();
    renderOverview({ plans: [planWithCompleted(1, 4)] });
    const widthOneOfFour = screen.getByRole("progressbar", { name: /Fremdrift i planen/ }).style.width;
    cleanup();
    renderOverview({ plans: [planWithCompleted(4, 4)] });
    expect(screen.getByRole("progressbar", { name: /Fremdrift i planen/ }).style.width).toBe(widthOneOfFour);
  });

  it("reports the step count to assistive technology", () => {
    cleanup();
    renderOverview({ plans: [planWithCompleted(1, 4)] });
    const track = within(screen.getByTestId(`timeline-row-${TREE_A}`)).getByRole("progressbar");
    expect(track.getAttribute("aria-valuenow")).toBe("1");
    expect(track.getAttribute("aria-valuemax")).toBe("4");
  });
});

describe("timeline milestone markers", () => {
  it("names each dated step with its date and completion state, not by colour alone", () => {
    renderOverview();
    const completed = screen.getByRole("img", { name: "Første steg, 1. des. 2026, fullført" });
    expect(completed.getAttribute("data-status")).toBe("completed");
    const open = screen.getByRole("img", { name: "Andre steg, 15. jan. 2027, ikke fullført" });
    expect(open.getAttribute("data-status")).toBe("in_progress");
  });

  it("keeps markers reachable from the keyboard", () => {
    renderOverview();
    const marker = screen.getByRole("img", { name: "Første steg, 1. des. 2026, fullført" });
    expect(marker.getAttribute("tabindex")).toBe("0");
  });

  it("explains the markers in a legend", () => {
    renderOverview();
    expect(screen.getByText("Fullført steg")).toBeTruthy();
    expect(screen.getByText("Planlagt eller pågående steg")).toBeTruthy();
  });
});

describe("right column summary", () => {
  it("shows real totals for active plans: plans, completed, remaining and overall percent", () => {
    renderOverview();
    const goals = screen.getByRole("heading", { name: "Mål for kompetanseutvikling" }).closest("section") as HTMLElement;
    expect(within(goals).getByText("Aktive planer").nextElementSibling?.textContent).toBe("2");
    expect(within(goals).getByText("Fullførte steg").nextElementSibling?.textContent).toBe("1");
    expect(within(goals).getByText("Gjenstående steg").nextElementSibling?.textContent).toBe("2");
    expect(within(goals).getByText("Samlet fremdrift").nextElementSibling?.textContent).toBe("33 %");
  });

  it("does not show a checklist or checkboxes in the overview", () => {
    renderOverview();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("lists the next open steps earliest first, with Norwegian dates and their area", () => {
    renderOverview();
    const next = screen.getByRole("heading", { name: "Neste steg" }).closest("section") as HTMLElement;
    const items = within(next).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Andre steg");
    expect(items[0].textContent).toContain("Testautomatisering");
    expect(items[0].textContent).toContain("15. jan. 2027");
    expect(items[1].textContent).toContain("Udatert steg");
    expect(items[1].textContent).toContain("Ingen dato");
  });

  it("flags a past-due open step as overdue", () => {
    renderOverview({ today: "2027-02-01" });
    const next = screen.getByRole("heading", { name: "Neste steg" }).closest("section") as HTMLElement;
    expect(within(next).getByText("Forfalt")).toBeTruthy();
  });

  it("opens the plan a next step belongs to", async () => {
    const onOpenPlan = vi.fn();
    renderOverview({ onOpenPlan });
    await userEvent.click(screen.getByRole("button", { name: "Vis plan for Testautomatisering, steg: Andre steg" }));
    expect(onOpenPlan).toHaveBeenCalledWith(TREE_A);
  });

  it("shows the area-unavailable label where a name is missing", () => {
    renderOverview({ nameOf: () => null });
    expect(screen.getAllByText("Kompetanseområdet er ikke tilgjengelig").length).toBeGreaterThan(0);
  });
});

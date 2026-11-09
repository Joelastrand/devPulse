// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ClientCompetencePlan } from "../client/competence-plan-gateway";
import { CompetencePlanOverview } from "./CompetencePlanOverview";

const TREE_A = "tree-a";
const TREE_B = "tree-b";
const NOV_2026 = { year: 2026, month: 11 };

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

afterEach(() => cleanup());

describe("CompetencePlanOverview", () => {
  it("switches the timeline between 3 and 6 months with pressed state", async () => {
    render(<CompetencePlanOverview plans={plans} nameOf={nameOf} start={NOV_2026} />);
    const six = screen.getByRole("button", { name: "6 måneder" });
    const three = screen.getByRole("button", { name: "3 måneder" });
    expect(six.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(three);
    expect(three.getAttribute("aria-pressed")).toBe("true");
    expect(six.getAttribute("aria-pressed")).toBe("false");
  });

  it("draws a bar for a plan with dated steps and says so when it has none in the window", () => {
    render(<CompetencePlanOverview plans={plans} nameOf={nameOf} start={NOV_2026} />);
    const rowA = screen.getByTestId(`timeline-row-${TREE_A}`);
    expect(within(rowA).getByText("Pågår (1 av 2 steg)")).toBeTruthy();
    const rowB = screen.getByTestId(`timeline-row-${TREE_B}`);
    expect(within(rowB).getByText("Ingen datoer i dette tidsrommet")).toBeTruthy();
  });

  it("lists the next open steps earliest first, with Norwegian dates", () => {
    render(<CompetencePlanOverview plans={plans} nameOf={nameOf} start={NOV_2026} />);
    const next = screen.getByRole("heading", { name: "Neste steg" }).closest("section");
    const items = within(next as HTMLElement).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Andre steg"),
      expect.stringContaining("Udatert steg"),
    ]);
    expect(items[0].textContent).toContain("15. jan. 2027");
  });

  it("ranks the team's needs by priority", () => {
    render(<CompetencePlanOverview plans={plans} nameOf={nameOf} start={NOV_2026} />);
    const needs = screen.getByRole("heading", { name: "Teamets behov" }).closest("section");
    const items = within(needs as HTMLElement).getAllByRole("listitem");
    expect(items[0].textContent).toContain("Observerbarhet");
    expect(items[0].textContent).toContain("Høy");
    expect(items[1].textContent).toContain("Testautomatisering");
  });

  it("shows the area-unavailable label where a name is missing", () => {
    render(<CompetencePlanOverview plans={plans} nameOf={() => null} start={NOV_2026} />);
    expect(screen.getAllByText("Kompetanseområdet er ikke tilgjengelig").length).toBeGreaterThan(0);
  });
});

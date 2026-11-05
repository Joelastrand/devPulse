// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoadmapItemView } from "../server/list-roadmap-items";
import { roadmapCopy } from "../copy";
import {
  buildRoadmapBoardColumns,
  RoadmapBoard,
  useWideRoadmapBoard,
} from "./RoadmapBoard";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("buildRoadmapBoardColumns (visual-redesign TASK-009)", () => {
  it("places a plan with a start in one quarter and a target in another only in its target-quarter column", () => {
    const columns = buildRoadmapBoardColumns([
      plan({
        treeId: "a",
        areaName: "Spanning",
        startDate: "2026-01-15",
        targetDate: "2026-08-20",
      }),
    ]);

    expect(columns.map((column) => column.label)).toEqual(["3. kvartal 2026"]);
    expect(columns[0]?.plans.map((item) => item.treeId)).toEqual(["a"]);
  });

  it("orders quarter columns by calendar quarter and puts undated plans in their own last column", () => {
    const columns = buildRoadmapBoardColumns([
      plan({ treeId: "late", targetDate: "2027-02-01" }),
      plan({ treeId: "none", targetDate: null }),
      plan({ treeId: "early", targetDate: "2026-04-10" }),
    ]);

    expect(columns.map((column) => column.label)).toEqual([
      "2. kvartal 2026",
      "1. kvartal 2027",
      roadmapCopy.board.undatedColumn,
    ]);
    expect(columns[2]?.plans.map((item) => item.treeId)).toEqual(["none"]);
  });

  it("keeps an overdue plan in its target-quarter column, never in a separate overdue column", () => {
    const columns = buildRoadmapBoardColumns([
      plan({ treeId: "od", targetDate: "2026-05-01", overdue: true }),
    ]);

    expect(columns.map((column) => column.label)).toEqual(["2. kvartal 2026"]);
    expect(columns[0]?.plans.map((item) => item.treeId)).toEqual(["od"]);
  });

  it("lists each plan exactly once across all columns", () => {
    const items = [
      plan({ treeId: "a", targetDate: "2026-01-01" }),
      plan({ treeId: "b", targetDate: null }),
      plan({ treeId: "c", targetDate: "2026-12-31" }),
    ];
    const ids = buildRoadmapBoardColumns(items).flatMap((column) =>
      column.plans.map((item) => item.treeId),
    );

    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("RoadmapBoard rendering", () => {
  const items = [
    plan({
      treeId: "a",
      areaName: "Containers",
      targetDate: "2026-04-10",
      status: "planned",
    }),
    plan({
      treeId: "b",
      areaName: "Sikkerhet",
      targetDate: null,
      status: "active",
    }),
  ];

  it("shows a column per quarter and the undated column, with the plan's status as text", () => {
    render(<RoadmapBoard items={items} editing={null} />);

    const quarterColumn = screen
      .getByRole("heading", { name: "2. kvartal 2026" })
      .closest("section") as HTMLElement;
    expect(
      within(quarterColumn).getByRole("button", { name: /Containers/ }),
    ).toBeTruthy();
    expect(
      within(quarterColumn).getByText(roadmapCopy.board.statusTiles.planned),
    ).toBeTruthy();

    const undatedColumn = screen
      .getByRole("heading", { name: roadmapCopy.board.undatedColumn })
      .closest("section") as HTMLElement;
    expect(
      within(undatedColumn).getByRole("button", { name: /Sikkerhet/ }),
    ).toBeTruthy();
  });

  it("selects a plan from the board and shows it in the detail panel", async () => {
    const user = userEvent.setup();
    render(<RoadmapBoard items={items} editing={null} />);

    const second = screen.getByRole("button", { name: /Sikkerhet/ });
    expect(second.getAttribute("aria-pressed")).toBe("false");
    await user.click(second);

    expect(second.getAttribute("aria-pressed")).toBe("true");
    const detail = screen.getByRole("complementary");
    expect(within(detail).getByText("Sikkerhet")).toBeTruthy();
  });

  it("shows the status counts as text tiles, not colour alone", () => {
    render(<RoadmapBoard items={items} editing={null} />);

    const planned = screen.getByRole("region", {
      name: roadmapCopy.board.statusTiles.planned,
    });
    expect(within(planned).getByText("1")).toBeTruthy();
  });
});

describe("useWideRoadmapBoard", () => {
  function Probe() {
    const wide = useWideRoadmapBoard();
    return <p>{wide ? "board" : "list"}</p>;
  }

  it("is false when matchMedia is unavailable, so the grouped list renders", async () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Probe />);
    expect(await screen.findByText("list")).toBeTruthy();
  });

  it("is true when the md breakpoint query matches", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 768px)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("board")).toBeTruthy());
  });
});

describe("RoadmapBoard column headers and cards (visual-redesign TASK-009)", () => {
  it("shows the month range on each quarter column and marks the current quarter 'I dag'", () => {
    const items = [
      plan({ treeId: "a", targetDate: "2026-05-10" }),
      plan({ treeId: "b", targetDate: "2026-11-02" }),
    ];
    render(<RoadmapBoard items={items} editing={null} today="2026-05-20" />);

    const current = screen
      .getByRole("heading", { name: "2. kvartal 2026" })
      .closest("section") as HTMLElement;
    expect(
      within(current).getByText(
        `apr–jun · ${roadmapCopy.board.currentQuarter}`,
      ),
    ).toBeTruthy();
    const other = screen
      .getByRole("heading", { name: "4. kvartal 2026" })
      .closest("section") as HTMLElement;
    expect(within(other).getByText("okt–des")).toBeTruthy();
    expect(
      within(other).queryByText(roadmapCopy.board.currentQuarter),
    ).toBeNull();
  });

  it("shows the plan title, priority and owner on each card, from existing fields only", () => {
    render(
      <RoadmapBoard
        items={[
          plan({
            treeId: "a",
            areaName: "Containers",
            targetLabel: "Production rollout",
            targetDate: "2026-04-10",
            priority: "high",
          }),
        ]}
        editing={null}
        today="2026-05-20"
      />,
    );

    const card = screen.getByRole("button", { name: /Production rollout/ });
    expect(within(card).getByText("Containers")).toBeTruthy();
    expect(
      within(card).getByText(
        `${roadmapCopy.labels.priority}: ${roadmapCopy.priority.high}`,
      ),
    ).toBeTruthy();
    expect(
      within(card).getByText(`${roadmapCopy.labels.owner}:`, { exact: false }),
    ).toBeTruthy();
  });

  it("renders each plan as one card in exactly one column section", () => {
    render(
      <RoadmapBoard
        items={[
          plan({
            treeId: "a",
            areaName: "Containers",
            targetDate: "2026-04-10",
          }),
          plan({ treeId: "b", areaName: "Sikkerhet", targetDate: null }),
        ]}
        editing={null}
        today="2026-05-20"
      />,
    );

    for (const name of [/Containers/, /Sikkerhet/]) {
      const cards = screen.getAllByRole("button", { name });
      expect(cards).toHaveLength(1);
      expect(cards[0]?.closest("section")).not.toBeNull();
    }
  });
});

describe("RoadmapBoard excludes Gantt, span bars and percentages (visual-fidelity-and-ui-fixes TASK-011)", () => {
  it("renders a quarter board without a Gantt, span bar or percentage", () => {
    const { container } = render(
      <RoadmapBoard
        items={[
          plan({
            treeId: "span",
            startDate: "2026-01-15",
            targetDate: "2026-08-20",
            targetLabel: "Spenner kvartaler",
          }),
          plan({ treeId: "none", targetDate: null, targetLabel: "Uten dato" }),
        ]}
        editing={null}
        today="2026-05-20"
      />,
    );

    expect(
      container.querySelector("[data-testid*='gantt' i], [class*='gantt' i]"),
    ).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/%/);
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RadarAxisInput } from "../domain/radar-model";
import { KompetanseprofilRadar } from "./KompetanseprofilRadar";

// Recharts measures the DOM; the test checks the data and props it receives, as TrendChart.test.tsx does.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RadarChart: ({ data, children }: { data: unknown; children: ReactNode }) => (
    <div data-testid="radar-chart" data-points={JSON.stringify(data)}>
      {children}
    </div>
  ),
  PolarGrid: () => null,
  PolarAngleAxis: () => null,
  PolarRadiusAxis: () => null,
  Radar: (props: { dataKey: string; strokeDasharray?: string; connectNulls?: boolean }) => (
    <span
      data-testid={`radar-${props.dataKey}`}
      data-dash={props.strokeDasharray ?? ""}
      data-connect={String(props.connectNulls)}
    />
  ),
}));

/** Synthetic fixtures only. */
const axis = (n: number, teamLevel: number | null, targetLevel: number | null = 3): RadarAxisInput => ({
  treeId: `tree-${n}`,
  label: `Område ${n}`,
  teamLevel,
  targetLevel,
});
const axesOf = (count: number): RadarAxisInput[] => Array.from({ length: count }, (_, i) => axis(i + 1, 2));

afterEach(cleanup);

function pointsOf(container: HTMLElement): Array<{ axis: string; team: number | null; target: number | null }> {
  const raw = within(container).getByTestId("radar-chart").getAttribute("data-points") ?? "[]";
  return JSON.parse(raw) as Array<{ axis: string; team: number | null; target: number | null }>;
}

describe("KompetanseprofilRadar rendering", () => {
  it.each([3, 4, 5])("renders a chart with %i points and a matching table", (count) => {
    const { container } = render(<KompetanseprofilRadar axes={axesOf(count)} />);
    expect(pointsOf(container)).toHaveLength(count);
    expect(screen.getAllByRole("rowheader")).toHaveLength(count);
  });

  it("draws the team polygon solid and the target polygon dashed, with gaps not zeros", () => {
    render(<KompetanseprofilRadar axes={axesOf(3)} />);
    expect(screen.getByTestId("radar-team").getAttribute("data-dash")).toBe("");
    expect(screen.getByTestId("radar-team").getAttribute("data-connect")).toBe("false");
    expect(screen.getByTestId("radar-target").getAttribute("data-dash")).toBe("4 3");
  });

  it("labels the chart with the heading and a summary, through role img", () => {
    render(<KompetanseprofilRadar axes={[axis(1, 2), axis(2, null), axis(3, 4)]} />);
    const img = screen.getByRole("img", { name: "Kompetanseprofil" });
    expect(img.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(img.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Teamets nivå er satt for 2 av 3 områder.",
    );
  });

  it("shows the same values in the text alternative as the chart data", () => {
    const { container } = render(<KompetanseprofilRadar axes={[axis(1, 2, 3), axis(2, 4, null), axis(3, null, 2)]} />);
    expect(pointsOf(container)).toEqual([
      { axis: "Område 1", team: 2, target: 3 },
      { axis: "Område 2", team: 4, target: null },
      { axis: "Område 3", team: null, target: 2 },
    ]);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Område 1" })).toBeTruthy();
    expect(within(table).getByRole("rowheader", { name: "Område 3" })).toBeTruthy();
  });
});

describe("missing values", () => {
  it("never draws an unset team value as zero, and says it is not set", () => {
    const { container } = render(<KompetanseprofilRadar axes={[axis(1, null, 3), axis(2, 2, 3), axis(3, 3, 3)]} />);
    expect(pointsOf(container)[0]?.team).toBeNull();
    expect(pointsOf(container).some((point) => point.team === 0)).toBe(false);
    expect(screen.getByRole("table").textContent).toContain("Ikke satt");
  });

  it("says when no target is set", () => {
    render(<KompetanseprofilRadar axes={[axis(1, 2, null), axis(2, 2, 3), axis(3, 2, 3)]} />);
    expect(screen.getByRole("table").textContent).toContain("Ikke angitt");
  });

  it("shows an empty message and no chart when nothing is set", () => {
    const { container } = render(<KompetanseprofilRadar axes={[axis(1, null, null), axis(2, null, null), axis(3, null, null)]} />);
    expect(screen.getByText("Ingen nivåer er satt ennå.")).toBeTruthy();
    expect(within(container).queryByTestId("radar-chart")).toBeNull();
  });
});

describe("axis limits", () => {
  it("shows the three-axis message and no chart for two axes, but still lists them", () => {
    const { container } = render(<KompetanseprofilRadar axes={[axis(1, 2), axis(2, 3)]} />);
    expect(screen.getByText("Legg til minst tre kompetanseområder for å se kompetanseprofilen.")).toBeTruthy();
    expect(within(container).queryByTestId("radar-chart")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("shows the table only above eight axes", () => {
    const { container } = render(<KompetanseprofilRadar axes={axesOf(9)} />);
    expect(screen.getByText("Profilen vises for opptil åtte områder. Se tabellen for alle områder.")).toBeTruthy();
    expect(within(container).queryByTestId("radar-chart")).toBeNull();
    expect(screen.getAllByRole("rowheader")).toHaveLength(9);
  });
});

describe("invalid input", () => {
  it("shows an error message and neither chart nor table", () => {
    const { container } = render(<KompetanseprofilRadar axes={[axis(1, 0), axis(2, 2), axis(3, 2)]} />);
    expect(screen.getByText("Kompetanseprofilen kan ikke vises akkurat nå.")).toBeTruthy();
    expect(within(container).queryByTestId("radar-chart")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("Norwegian labels and forbidden content", () => {
  it("uses the owner's labels and no average, count or decimal wording", () => {
    const { container } = render(<KompetanseprofilRadar axes={axesOf(3)} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Teamets nivå");
    expect(text).toContain("Forventet nivå");
    expect(text.toLowerCase()).not.toContain("gjennomsnitt");
    expect(text.toLowerCase()).not.toContain("medlemmer har bidratt");
    expect(text).not.toMatch(/\d,\d/);
    expect(text).not.toMatch(/\d\.\d/);
  });

  it("never names anonymity", () => {
    const { container } = render(<KompetanseprofilRadar axes={axesOf(3)} />);
    expect(container.textContent?.toLowerCase()).not.toContain("anonym");
  });
});

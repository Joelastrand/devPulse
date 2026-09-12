// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PeriodAggregateResult } from "../domain/aggregation";

/**
 * `recharts` renders real SVG sized by the DOM (via `ResponsiveContainer`),
 * which jsdom cannot measure meaningfully, and its exact SVG output is an
 * implementation detail this task's own instructions say not to assert on.
 * Stubbing it lets these tests assert the *behavioral* contract instead:
 * exactly what data/props this component hands to the chart library — the
 * same approach the SPEC's own verification note calls for ("a behavioral
 * assertion on the rendered output/props passed into Recharts, not a
 * visual snapshot"). Names are `mock`-prefixed per this repo's established
 * Vitest hoisting convention (see e.g. `AdminTeams.test.tsx`).
 */
const mockResponsiveContainer = vi.fn(({ children }: { children: ReactNode }) => (
  <div data-testid="responsive-container">{children}</div>
));
const mockLineChart = vi.fn(
  ({ children }: { data: unknown; children: ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
);
interface MockLineProps {
  dataKey: string;
  connectNulls: boolean;
  strokeDasharray?: string;
  [key: string]: unknown;
}

const mockLine = vi.fn<(props: MockLineProps) => null>(() => null);

vi.mock("recharts", () => ({
  ResponsiveContainer: (props: { children: ReactNode }) => mockResponsiveContainer(props),
  LineChart: (props: { data: unknown; children: ReactNode }) => mockLineChart(props),
  Line: (props: MockLineProps) => mockLine(props),
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  CartesianGrid: () => null,
}));

const { TrendChart, buildTrendSeries } = await import("./TrendChart");

const MIXED_RESULTS: PeriodAggregateResult[] = [
  { period: "2026-W23", status: "not_available" },
  { period: "2026-W24", status: "insufficient" },
  {
    period: "2026-W25",
    status: "published",
    mean: { flow: 3.2, stress: 2.4, fun: 4.6 },
    count: 8,
  },
  {
    period: "2026-W26",
    status: "published",
    mean: { flow: 1, stress: 5, fun: 1.5 },
    count: 6,
  },
];

describe("buildTrendSeries", () => {
  it("maps a published period to its exact mean values, never rounding or estimating", () => {
    const series = buildTrendSeries([
      { period: "2026-W25", status: "published", mean: { flow: 3.2, stress: 2.4, fun: 4.6 }, count: 8 },
    ]);

    expect(series).toEqual([
      { period: "2026-W25", flow: 3.2, stress: 2.4, fun: 4.6, suppressed: false },
    ]);
  });

  it("maps insufficient and not_available periods to null for every dimension, never zero", () => {
    const series = buildTrendSeries([
      { period: "2026-W23", status: "not_available" },
      { period: "2026-W24", status: "insufficient" },
    ]);

    for (const row of series) {
      expect(row.flow).toBeNull();
      expect(row.stress).toBeNull();
      expect(row.fun).toBeNull();
      expect(row.suppressed).toBe(true);
      // Explicitly rule out the exact regression BR-20 forbids.
      expect(row.flow).not.toBe(0);
    }
  });

  it("preserves period order and count exactly as given (no reordering, no dropped/added periods)", () => {
    const series = buildTrendSeries(MIXED_RESULTS);

    expect(series.map((row) => row.period)).toEqual([
      "2026-W23",
      "2026-W24",
      "2026-W25",
      "2026-W26",
    ]);
    expect(series).toHaveLength(MIXED_RESULTS.length);
  });

  it("returns an empty array for no periods", () => {
    expect(buildTrendSeries([])).toEqual([]);
  });
});

describe("TrendChart", () => {
  afterEach(() => {
    cleanup();
    mockResponsiveContainer.mockClear();
    mockLineChart.mockClear();
    mockLine.mockClear();
  });

  it("renders nothing when there are no periods to show", () => {
    const { container } = render(<TrendChart results={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders a visible heading and description that are not hidden from assistive technology", () => {
    render(<TrendChart results={MIXED_RESULTS} />);

    const heading = screen.getByRole("heading", { name: /trendvisualisering/i });
    expect(heading.closest("[aria-hidden]")).toBeNull();
    expect(screen.getByText(/brudd i linjen/i)).toBeTruthy();
  });

  it("hides only the chart's own SVG region from assistive technology, since the table remains the accessible source of truth", () => {
    render(<TrendChart results={MIXED_RESULTS} />);

    expect(screen.getByTestId("responsive-container").closest("[aria-hidden='true']")).toBeTruthy();
  });

  it("passes the same suppression-safe rows to the chart that buildTrendSeries computes, in the same order", () => {
    render(<TrendChart results={MIXED_RESULTS} />);

    expect(mockLineChart).toHaveBeenCalledTimes(1);
    const passedData = mockLineChart.mock.calls[0][0].data;
    expect(passedData).toEqual(buildTrendSeries(MIXED_RESULTS));
  });

  it("renders one line per dimension, never connecting a line across a suppressed gap", () => {
    render(<TrendChart results={MIXED_RESULTS} />);

    expect(mockLine).toHaveBeenCalledTimes(3);
    const dataKeys = mockLine.mock.calls.map((call) => call[0].dataKey);
    expect(dataKeys.sort()).toEqual(["flow", "fun", "stress"]);
    for (const call of mockLine.mock.calls) {
      expect(call[0].connectNulls).toBe(false);
    }
  });

  it("distinguishes each dimension's line by more than color alone", () => {
    render(<TrendChart results={MIXED_RESULTS} />);

    const dashPatterns = mockLine.mock.calls.map((call) => call[0].strokeDasharray);
    // Three lines, three distinct dash treatments (including "no dash" for
    // the first) — a colorblind viewer can still tell the series apart.
    expect(new Set(dashPatterns).size).toBe(3);
  });

  it("makes no network or gateway call of its own — it only ever renders the props it was given", () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => {
      throw new Error("TrendChart must never fetch on its own");
    });

    render(<TrendChart results={MIXED_RESULTS} />);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

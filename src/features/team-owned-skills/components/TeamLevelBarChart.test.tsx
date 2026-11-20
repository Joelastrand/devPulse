// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamLevelBarChart, sortBarRows, wrapAreaLabel, type TeamLevelBarRow } from "./TeamLevelBarChart";

// Recharts measures the DOM; the test checks the data and the props it receives, as KompetanseprofilRadar.test.tsx does.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ data, children }: { data: unknown; children: ReactNode }) => (
    <div data-testid="bar-chart" data-rows={JSON.stringify(data)}>
      {children}
    </div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Bar: ({ dataKey }: { dataKey: string }) => <span data-testid={`bar-${dataKey}`} />,
  LabelList: () => null,
}));

/** Synthetic fixtures only. */
const row = (skillId: string, name: string, level: number): TeamLevelBarRow => ({ skillId, name, level });

afterEach(cleanup);

describe("sortBarRows", () => {
  it("sorts by area name in Norwegian collation, so Æ, Ø and Å follow Z", () => {
    const sorted = sortBarRows([row("a", "Zebra", 1), row("b", "Ørn", 2), row("c", "Åpen", 3), row("d", "Ada", 4)]);
    expect(sorted.map((item) => item.name)).toEqual(["Ada", "Zebra", "Ørn", "Åpen"]);
  });

  it("does not mutate its input", () => {
    const input = [row("a", "Zebra", 1), row("b", "Ada", 2)];
    sortBarRows(input);
    expect(input.map((item) => item.name)).toEqual(["Zebra", "Ada"]);
  });
});

describe("wrapAreaLabel", () => {
  it("keeps a short name on one line", () => {
    expect(wrapAreaLabel("Testing")).toEqual(["Testing"]);
  });

  it("splits a long Norwegian name into lines at word boundaries and loses no words", () => {
    const label = "Systemutvikling og kvalitetssikring av integrasjoner mot eksterne tjenester";
    const lines = wrapAreaLabel(label, 28);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 28)).toBe(true);
    expect(lines.join(" ")).toBe(label);
  });

  it("keeps a single word longer than the line on its own line", () => {
    expect(wrapAreaLabel("Kubernetesorkestrering", 10)).toEqual(["Kubernetesorkestrering"]);
  });
});

describe("TeamLevelBarChart", () => {
  it("passes every eligible area with its team level to the chart, sorted by name", () => {
    render(<TeamLevelBarChart rows={[row("sk2", "Kubernetes", 2), row("sk1", "Testing", 3), row("sk3", "Terraform", 4)]} />);
    const data = JSON.parse(screen.getByTestId("bar-chart").getAttribute("data-rows") ?? "[]");
    expect(data).toEqual([
      { key: "sk2", name: "Kubernetes", level: 2 },
      { key: "sk3", name: "Terraform", level: 4 },
      { key: "sk1", name: "Testing", level: 3 },
    ]);
  });

  it("draws the team level series from the level field", () => {
    render(<TeamLevelBarChart rows={[row("sk1", "Testing", 3)]} />);
    expect(screen.getByTestId("bar-level")).toBeTruthy();
  });

  it("labels the chart with a Norwegian description and the level scale", () => {
    render(<TeamLevelBarChart rows={[row("sk1", "Testing", 3)]} />);
    // The heading and description belong to the page's collapsible section; the chart is named by its image label.
    expect(screen.getByRole("img", { name: "Teamets nivå per kompetanseområde" })).toBeTruthy();
    expect(screen.queryByText(/Tallet ved hver søyle er nivået/)).toBeNull();
  });

  it("renders nothing when no area has a calculated level", () => {
    const { container } = render(<TeamLevelBarChart rows={[]} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByTestId("bar-chart")).toBeNull();
  });

  it("keeps a long Norwegian area name in the data unchanged, for the wrapped axis label to render", () => {
    const long = "Systemutvikling og kvalitetssikring av integrasjoner mot eksterne tjenester";
    render(<TeamLevelBarChart rows={[row("sk1", long, 2)]} />);
    const data = JSON.parse(screen.getByTestId("bar-chart").getAttribute("data-rows") ?? "[]") as Array<{ name: string }>;
    expect(data[0]?.name).toBe(long);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { SELF_ASSESSED_LEVEL_COPY } from "../copy";

// Recharts measures the DOM. The test checks the series it receives and the text alternative, as KompetanseprofilRadar.test.tsx does.
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
  Radar: (props: { name: string; dataKey: string; strokeDasharray?: string }) => (
    <span data-testid={`radar-${props.dataKey}`} data-name={props.name} data-dash={props.strokeDasharray ?? ""} />
  ),
}));

const { PersonalRadar, wrapAxisLabel } = await import("./PersonalRadar");

afterEach(cleanup);

/** Synthetic fixtures only. */
const POINTS = [
  { treeId: "api", label: "API-design", own: 4 as const, target: 3 as const },
  { treeId: "test", label: "Testing", own: 1 as const, target: 3 as const },
  { treeId: "team", label: "Teamarbeid", own: 3 as const, target: null },
];

const TARGET_LEGEND = "Rolleforventning (Seniorutvikler)";

function renderRadar(showTarget: boolean, omittedCount = 0) {
  return render(
    <PersonalRadar
      points={POINTS.map((point) => ({ ...point, target: showTarget ? point.target : null }))}
      showTarget={showTarget}
      roleName="Seniorutvikler"
      omittedCount={omittedCount}
    />,
  );
}

describe("PersonalRadar text alternative (C1 BR-31: nothing conveyed by shape or colour alone)", () => {
  it("names the chart with the number of plotted skills", () => {
    renderRadar(false);
    expect(screen.getByRole("img", { name: "Kompetanseprofil for 3 vurderte ferdigheter" })).toBeTruthy();
  });

  it("gives each plotted skill's own level name in a visually hidden table", () => {
    renderRadar(false);
    const table = screen.getByRole("table", { hidden: true });
    const apiRow = within(table).getByRole("row", { name: /API-design/, hidden: true });
    expect(within(apiRow).getByText(SELF_ASSESSED_LEVEL_COPY[4].name, { exact: true })).toBeTruthy();
    const testRow = within(table).getByRole("row", { name: /Testing/, hidden: true });
    expect(within(testRow).getByText(SELF_ASSESSED_LEVEL_COPY[1].name, { exact: true })).toBeTruthy();
  });

  it("draws only the person's own series when no complete target is shown, with no target legend or column", () => {
    renderRadar(false);
    expect(screen.queryByTestId("radar-target")).toBeNull();
    expect(screen.getByTestId("radar-own").getAttribute("data-name")).toBe("Min vurdering");
    expect(screen.queryByText(TARGET_LEGEND)).toBeNull();
    const headers = screen.getAllByRole("columnheader", { hidden: true }).map((header) => header.textContent);
    expect(headers).toEqual(["Ferdigheter", "Min vurdering"]);
    expect(screen.getByText("Rolleforventningen vises når alle ferdighetene i diagrammet har en forventning i målrollen.")).toBeTruthy();
  });

  it("adds the dashed target series, its legend and its column when every plotted skill has an expectation", () => {
    renderRadar(true);
    const target = screen.getByTestId("radar-target");
    expect(target.getAttribute("data-name")).toBe(TARGET_LEGEND);
    expect(target.getAttribute("data-dash")).toBe("4 3");
    expect(screen.getAllByText(TARGET_LEGEND).length).toBeGreaterThan(0);
  });

  it("says when some assessed skills are only in the list, not in the chart", () => {
    renderRadar(false, 2);
    expect(screen.getByText("2 vurderte ferdigheter vises bare i listen.")).toBeTruthy();
  });
});

describe("wrapAxisLabel (axis labels stay inside the card; the full name stays in the list and table)", () => {
  it("keeps short names on one line", () => {
    expect(wrapAxisLabel("Testing")).toEqual(["Testing"]);
  });

  it("wraps at word boundaries and never splits a word that fits", () => {
    expect(wrapAxisLabel("Syntetisk Integrasjoner", 14)).toEqual(["Syntetisk", "Integrasjoner"]);
  });

  it("cuts a single word longer than a line and ends a truncated block with an ellipsis", () => {
    const lines = wrapAxisLabel("aaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbb cccccccccccccccc dddddddddddddddd", 10, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith("…")).toBe(true);
    expect(lines.every((line) => line.length <= 10)).toBe(true);
  });
});

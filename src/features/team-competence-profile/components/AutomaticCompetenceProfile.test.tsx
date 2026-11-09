// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutomaticSkillLevelRow } from "../domain/automatic-profile";
import { KOMPETANSEPROFIL_COPY } from "../copy";
import { AutomaticCompetenceProfile } from "./AutomaticCompetenceProfile";

// Recharts measures the DOM; the test checks the data it receives, as KompetanseprofilRadar.test.tsx does.
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
  Radar: () => null,
}));

/** Synthetic fixtures only. */
const value = (n: number, level: number): AutomaticSkillLevelRow => ({
  treeId: `tree-${n}`,
  areaName: `Område ${n}`,
  targetLevel: 3,
  state: "value",
  level,
});
const insufficient = (n: number): AutomaticSkillLevelRow => ({
  treeId: `tree-${n}`,
  areaName: `Område ${n}`,
  targetLevel: 3,
  state: "insufficient_data",
});

afterEach(cleanup);

function pointsOf(container: HTMLElement): Array<{ axis: string; team: number | null }> {
  const raw = within(container).getByTestId("radar-chart").getAttribute("data-points") ?? "[]";
  return JSON.parse(raw) as Array<{ axis: string; team: number | null }>;
}

describe("AutomaticCompetenceProfile", () => {
  it("passes the team levels through and keeps an insufficient_data area as a gap, never zero", () => {
    const { container } = render(
      <AutomaticCompetenceProfile rows={[value(1, 2), insufficient(2), value(3, 4)]} />,
    );
    expect(pointsOf(container)).toEqual([
      { axis: "Område 1", team: 2, target: 3 },
      { axis: "Område 2", team: null, target: 3 },
      { axis: "Område 3", team: 4, target: 3 },
    ]);
    expect(screen.getAllByText(KOMPETANSEPROFIL_COPY.unset)).toHaveLength(1);
  });

  it("shows the invalid message and draws no chart when a level is malformed", () => {
    const malformed = { ...value(2, 2), level: 2.5 };
    const { container } = render(<AutomaticCompetenceProfile rows={[value(1, 2), malformed, value(3, 3)]} />);
    expect(screen.getByText(KOMPETANSEPROFIL_COPY.invalid)).toBeTruthy();
    expect(within(container).queryByTestId("radar-chart")).toBeNull();
  });
});

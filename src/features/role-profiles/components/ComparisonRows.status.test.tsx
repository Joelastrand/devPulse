// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComparisonRowView } from "../client/role-target-gateway";
import { personRoleCopy } from "../copy";
import { ComparisonRows } from "./ComparisonRows";

const copy = personRoleCopy.comparison;

afterEach(cleanup);

const ROWS: ComparisonRowView[] = [
  { treeId: "api", treeName: "API design", expectedLevel: 3, status: "meets", ownLevel: 4 },
  { treeId: "testing", treeName: "Testing", expectedLevel: 2, status: "development_opportunity", ownLevel: 1 },
  { treeId: "ops", treeName: "Operations", expectedLevel: 4, status: "not_assessed", ownLevel: null },
  { treeId: "broken", treeName: null, expectedLevel: 2, status: "area_unavailable", ownLevel: null },
];

describe("ComparisonRows state presentation (TASK-031)", () => {
  it.each([
    ["API design", copy.meets],
    ["Testing", copy.developmentOpportunity],
    ["Operations", copy.notAssessed],
    [copy.areaUnavailable, copy.unavailable],
  ])("shows the state text and a decorative icon for %s", (name, label) => {
    render(<ComparisonRows comparison={{ state: "available", target: { roleId: "r", name: "Backend" }, rows: ROWS }} />);

    const row = screen.getByText(name).closest("li") as HTMLElement;
    const badge = row.querySelector("span[class*='rounded-field']") as HTMLElement;
    expect(badge.textContent).toBe(label);
    const icon = badge.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the rows in the response order with no totals or sorting", () => {
    const { container } = render(
      <ComparisonRows comparison={{ state: "available", target: { roleId: "r", name: "Backend" }, rows: ROWS }} />,
    );

    const names = Array.from(container.querySelectorAll("li p:first-child")).map((p) => p.textContent);
    expect(names).toEqual(["API design", "Testing", "Operations", copy.areaUnavailable]);
    expect(container.textContent).not.toMatch(/\b\d+ av \d+\b|totalt|sum/i);
  });
});

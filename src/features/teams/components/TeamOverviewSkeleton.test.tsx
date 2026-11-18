// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamOverviewSkeleton } from "./TeamOverviewSkeleton";

describe("TeamOverviewSkeleton", () => {
  afterEach(cleanup);

  it("announces the team loading label once, inside a busy region", () => {
    render(<TeamOverviewSkeleton label="Laster team…" />);

    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toBe("Laster team…");
    expect(statuses[0].parentElement?.getAttribute("aria-busy")).toBe("true");
  });

  it("hides every placeholder block from assistive technology", () => {
    const { container } = render(<TeamOverviewSkeleton label="Laster team…" />);

    const hiddenGroups = container.querySelectorAll('[aria-hidden="true"]');
    expect(hiddenGroups.length).toBeGreaterThanOrEqual(4);
    // Only the status message is exposed; no placeholder block is announced or focusable.
    expect(container.querySelectorAll("button, a, input")).toHaveLength(0);
  });

  it("reserves the four KPI card slots and the two lower panels", () => {
    const { container } = render(<TeamOverviewSkeleton label="Laster team…" />);

    const kpiGrid = container.querySelector(".xl\\:grid-cols-4");
    expect(kpiGrid?.children).toHaveLength(4);
    const lowerGrid = container.querySelector(".lg\\:grid-cols-2");
    expect(lowerGrid?.children).toHaveLength(2);
  });

  it("does not animate the placeholder (no looping animation class)", () => {
    const { container } = render(<TeamOverviewSkeleton label="Laster team…" />);

    expect(container.innerHTML).not.toMatch(/animate-/);
  });
});

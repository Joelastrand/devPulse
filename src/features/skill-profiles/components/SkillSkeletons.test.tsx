// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SkillListSkeleton, SkillOverviewSkeleton } from "./SkillSkeletons";

afterEach(cleanup);

describe("personal skills loading placeholders", () => {
  it("announces the overview as one busy status and keeps the placeholders decorative", () => {
    const { container } = render(<SkillOverviewSkeleton label="Laster ferdighetene dine…" />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("Laster ferdighetene dine…");
    expect(screen.getByRole("status").closest('[aria-busy="true"]')).not.toBeNull();
    const decorative = container.querySelector('[aria-hidden="true"]');
    expect(decorative?.textContent).toBe("");
    expect(screen.queryByRole("list", { hidden: false })).toBeNull();
  });

  it("reserves the radar box height so the chart does not shift when it mounts", () => {
    const { container } = render(<SkillOverviewSkeleton label="Laster ferdighetene dine…" />);

    expect(container.querySelector(".h-\\[300px\\]")).not.toBeNull();
  });

  it("shows the editing list placeholder as one announcement with no skill names", () => {
    const { container } = render(<SkillListSkeleton label="Laster ferdighetene dine…" />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelectorAll('[aria-hidden="true"] li')).toHaveLength(3);
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("");
  });
});

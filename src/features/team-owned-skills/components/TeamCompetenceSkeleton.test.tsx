// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamCompetenceSkeleton } from "./TeamCompetenceSkeleton";

describe("TeamCompetenceSkeleton", () => {
  afterEach(cleanup);

  it("announces the loading label once and reveals no competency text while loading", () => {
    const { container } = render(<TeamCompetenceSkeleton label="Laster kompetanser …" />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    // Every placeholder block is text-free, so the only text in the region is the loading label.
    expect(container.textContent).toBe("Laster kompetanser …");
  });

  it("reserves the radar and bar chart heights used by the loaded charts", () => {
    const { container } = render(<TeamCompetenceSkeleton label="Laster kompetanser …" />);

    expect(container.querySelector("[class*=\"h-[280px]\"]")).not.toBeNull();
    expect(container.querySelectorAll("[class*=\"h-[280px]\"]").length).toBe(2);
  });
});

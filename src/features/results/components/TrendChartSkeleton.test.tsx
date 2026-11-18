// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { resultsCopy } from "../copy";
import { TrendChartSkeleton } from "./TrendChartSkeleton";

describe("TrendChartSkeleton", () => {
  afterEach(cleanup);

  it("keeps the chart's heading, description and plot height so the card does not move on load", () => {
    const { container } = render(<TrendChartSkeleton />);

    expect(screen.getByRole("heading", { name: resultsCopy.trendChart.heading })).toBeTruthy();
    expect(screen.getByText(resultsCopy.trendChart.description)).toBeTruthy();
    expect(container.querySelector(".h-64")).not.toBeNull();
  });

  it("keeps the plot box decorative and announces nothing when no label is given", () => {
    const { container } = render(<TrendChartSkeleton />);

    expect(container.querySelector('.h-64[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces the given label once when the chart is the region's loading state", () => {
    render(<TrendChartSkeleton label={resultsCopy.trendChart.loading} />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe(resultsCopy.trendChart.loading);
  });
});

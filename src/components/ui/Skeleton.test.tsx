// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LoadingRegion, Skeleton, SkeletonCard, SkeletonText } from "./Skeleton";

describe("Skeleton primitives", () => {
  afterEach(cleanup);

  it("hides decorative blocks from assistive technology", () => {
    const { container } = render(<Skeleton className="h-4" />);

    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the requested number of text lines, all hidden", () => {
    const { container } = render(<SkeletonText lines={4} />);

    const wrapper = container.firstElementChild;
    expect(wrapper?.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper?.children).toHaveLength(4);
  });

  it("renders card placeholders with the bordered surface and hidden lines", () => {
    const { container } = render(<SkeletonCard />);

    expect(container.firstElementChild?.className).toContain("rounded-surface");
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("announces the region once with aria-busy and nothing per block", () => {
    render(
      <LoadingRegion label="Laster resultater…">
        <SkeletonCard />
      </LoadingRegion>,
    );

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("Laster resultater…");
    expect(screen.getByRole("status").parentElement?.getAttribute("aria-busy")).toBe("true");
  });
});

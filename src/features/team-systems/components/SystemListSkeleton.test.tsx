// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SystemListSkeleton } from "./SystemListSkeleton";

describe("SystemListSkeleton", () => {
  afterEach(cleanup);

  it("announces the loading label once and shows no system or classification text", () => {
    const { container } = render(<SystemListSkeleton label="Laster systemer …" />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    // Classification badges are plain blocks, so no classification value can be mistaken for real data.
    expect(container.textContent).toBe("Laster systemer …");
  });

  it("renders three placeholder system cards inside the decorative group", () => {
    const { container } = render(<SystemListSkeleton label="Laster systemer …" />);

    const decorative = container.querySelector('[aria-hidden="true"]');
    expect(decorative?.querySelectorAll(".rounded-surface")).toHaveLength(3);
  });
});

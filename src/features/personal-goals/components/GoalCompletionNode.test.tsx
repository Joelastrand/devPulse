// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { GoalCompletionNode } from "./GoalCompletionNode";

describe("GoalCompletionNode (TASK-032)", () => {
  it("is decorative: hidden from assistive technology, the status text carries meaning", () => {
    const { container } = render(<GoalCompletionNode completed />);

    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toBe("");
  });

  it("fills when the goal is completed and is empty when it is active", () => {
    const { container, rerender } = render(<GoalCompletionNode completed={false} />);
    expect(container.firstElementChild?.className).not.toContain("bg-success-text");

    rerender(<GoalCompletionNode completed />);
    expect(container.firstElementChild?.className).toContain("bg-success-text");
  });

  it("changes state over the 300 ms progress duration, which the reduced-motion rule disables", () => {
    const { container } = render(<GoalCompletionNode completed />);

    expect(container.firstElementChild?.className).toContain("duration-progress");
  });
});

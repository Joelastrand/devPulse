// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Card } from "./Card";

describe("Card nested variant (Product Experience TASK-045)", () => {
  it("is a fill with no border, for a surface inside a bordered surface", () => {
    const { container } = render(<Card variant="nested">x</Card>);

    const className = container.firstElementChild?.className ?? "";
    expect(className).toContain("bg-surface-subtle");
    expect(className).not.toMatch(/(^|\s)border(\s|$)/);
  });
});

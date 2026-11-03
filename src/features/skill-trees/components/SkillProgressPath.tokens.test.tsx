// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SkillProgressPath } from "./SkillProgressPath";
import { skillProgressPathCopy } from "../copy";

const NODES = [
  { nodeId: "a", label: "Grunnleggende", order: 1 },
  { nodeId: "b", label: "Med støtte", order: 2 },
  { nodeId: "c", label: "Selvstendig", order: 3 },
] as const;

describe("SkillProgressPath presentation (TASK-041)", () => {
  it("names the current stage in text and marks it aria-current=step", () => {
    render(<SkillProgressPath name="Arkitektur" nodes={NODES as never} currentNodeId="b" />);

    const current = screen.getByText("Med støtte").closest("li") as HTMLElement;
    expect(current.getAttribute("aria-current")).toBe("step");
    expect(current.textContent).toContain(skillProgressPathCopy.state.current);
  });

  it("gives every stage a text state, so no state is conveyed by colour alone", () => {
    const { container } = render(<SkillProgressPath name="Arkitektur" nodes={NODES as never} currentNodeId="b" />);

    const items = within(container.querySelector("ol") as HTMLElement).getAllByRole("listitem");
    expect(items[0].textContent).toContain(skillProgressPathCopy.state.earlier);
    expect(items[2].textContent).toContain(skillProgressPathCopy.state.upcoming);
  });
});

describe("stage transition (TASK-043)", () => {
  it("animates the marker's state change over the 300 ms progress duration", () => {
    const { container } = render(<SkillProgressPath name="Arkitektur" nodes={NODES as never} currentNodeId="b" />);

    const marker = container.querySelector("li span.rounded-full") as HTMLElement;
    expect(marker.className).toContain("transition-colors");
    expect(marker.className).toContain("duration-progress");
  });
});

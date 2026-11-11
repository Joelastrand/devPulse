// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TeamSkillRatingControl } from "./TeamSkillRatingControl";

describe("TeamSkillRatingControl", () => {
  afterEach(cleanup);

  it("names every option with the skill and the full level name, and marks the selected one by state", () => {
    render(<TeamSkillRatingControl skillName="TypeScript" value={3} onSelect={() => {}} />);

    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "TypeScript: 3. Kan selvstendig" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "TypeScript: 1. Grunnleggende kjennskap" }).getAttribute("aria-checked")).toBe("false");
  });

  it("does not save when focus moves with the arrow keys, only when a level is chosen", () => {
    const onSelect = vi.fn();
    render(<TeamSkillRatingControl skillName="React" value={null} onSelect={onSelect} />);

    const first = screen.getByRole("radio", { name: "React: 1. Grunnleggende kjennskap" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("radio", { name: "React: 2. Kan med støtte" }), { key: "ArrowRight" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "React: 3. Kan selvstendig" }));
  });

  it("saves the level that is clicked, once", () => {
    const onSelect = vi.fn();
    render(<TeamSkillRatingControl skillName="React" value={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("radio", { name: "React: 4. Avansert" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it("keeps exactly one option in the tab order: the selected one, or the first when none is selected", () => {
    const { rerender } = render(<TeamSkillRatingControl skillName="Go" value={2} onSelect={() => {}} />);
    expect(screen.getAllByRole("radio").map((node) => node.getAttribute("tabindex"))).toEqual(["-1", "0", "-1", "-1"]);

    rerender(<TeamSkillRatingControl skillName="Go" value={null} onSelect={() => {}} />);
    expect(screen.getAllByRole("radio").map((node) => node.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
  });
});

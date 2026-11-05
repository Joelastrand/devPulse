// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SkillNextSteps } from "./SkillNextSteps";
import { skillProfileCopy } from "../copy";

afterEach(() => {
  cleanup();
});

describe("SkillNextSteps (visual-redesign TASK-010)", () => {
  it("offers at most three links to existing pages, in a labelled panel", () => {
    render(<SkillNextSteps />);

    const panel = screen.getByRole("heading", { name: skillProfileCopy.nextSteps.heading }).closest("section") as HTMLElement;
    const links = within(panel).getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/teams", "/me/conversations", "/me/profile"]);
  });
});

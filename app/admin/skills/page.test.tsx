// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../src/features/skill-trees/components/AdminSkills", () => ({
  AdminSkills: () => <div data-testid="admin-skills" />,
}));

const { default: AdminSkillsPage } = await import("./page");
const { WIDTH_CLASSNAMES } = await import("../../../src/components/ui/PageShell");

describe("AdminSkillsPage", () => {
  it("renders at the wide PageShell width (docs/features/ui-refresh/SPEC.md — BR-5)", () => {
    render(<AdminSkillsPage />);

    expect(screen.getByRole("main").className).toContain(WIDTH_CLASSNAMES.wide);
  });
});

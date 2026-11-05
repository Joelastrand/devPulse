// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../../src/components/ui/heading-structure";
import { cleanup } from "@testing-library/react";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../src/features/skill-trees/components/AdminSkills", () => ({
  AdminSkills: () => <div data-testid="admin-skills" />,
}));

const { default: AdminSkillsPage } = await import("./page");

describe("AdminSkillsPage", () => {
  it("renders at the wide PageShell width (docs/features/ui-refresh/SPEC.md — BR-5)", () => {
    render(<AdminSkillsPage />);

    expect(screen.getByRole("main").closest(".max-w-main")).not.toBeNull();
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    render(<AdminSkillsPage />);
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

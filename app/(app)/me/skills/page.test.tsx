// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../../src/components/ui/heading-structure";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/me/skills" }));
vi.mock("../../../../src/features/skill-profiles/components/SkillProfilePage", () => ({
  SkillProfilePage: ({ sidePanel }: { sidePanel?: React.ReactNode }) => (
    <div data-testid="skill-profile-page">{sidePanel}</div>
  ),
}));

vi.mock("../../../../src/features/team-skills/components/OwnCompetenceSharing", () => ({
  OwnCompetenceSharing: () => <div data-testid="own-competence-sharing" />,
}));

vi.mock("../../../../src/features/role-profiles/components/RoleTargetSection", () => ({
  RoleTargetSection: () => <div data-testid="role-target-section" />,
}));

const { default: MySkillsPage } = await import("./page");

afterEach(cleanup);

describe("/me/skills page", () => {
  it("keeps its title and C1 content and adds the shared personal navigation with Ferdigheter current", () => {
    render(<MySkillsPage />);
    expect(screen.getByRole("heading", { name: "Mine ferdigheter" })).toBeTruthy();
    expect(screen.getByTestId("skill-profile-page")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Personlig utvikling" });
    expect(nav.querySelector('a[aria-current="page"]')?.textContent).toBe("Ferdigheter");
    expect(screen.getByTestId("role-target-section")).toBeTruthy();
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    render(<MySkillsPage />);
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

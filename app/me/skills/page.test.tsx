// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/me/skills" }));
vi.mock("../../../src/features/skill-profiles/components/SkillProfilePage", () => ({
  SkillProfilePage: () => <div data-testid="skill-profile-page" />,
}));

vi.mock("../../../src/features/role-profiles/components/RoleTargetSection", () => ({
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

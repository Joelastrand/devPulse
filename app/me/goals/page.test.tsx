// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/me/goals" }));
vi.mock("../../../src/features/personal-goals/components/GoalsPage", () => ({
  GoalsPage: () => <div data-testid="goals-page" />,
}));

const { default: MyGoalsPage } = await import("./page");

afterEach(cleanup);

describe("/me/goals page", () => {
  it("renders the Mål heading, the goals feature component and the shared personal navigation with Mål current", () => {
    render(<MyGoalsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Mål" })).toBeTruthy();
    expect(screen.getByTestId("goals-page")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Personlig utvikling" });
    const current = nav.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe("Mål");
  });
});

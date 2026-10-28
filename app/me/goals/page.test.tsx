// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/me/goals" }));
vi.mock("../../../src/features/personal-goals/components/GoalsPage", () => ({
  GoalsPage: (props: { initialTreeId?: string }) => <div data-testid="goals-page" data-tree={props.initialTreeId ?? ""} />,
}));

const { default: MyGoalsPage } = await import("./page");

afterEach(cleanup);

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await MyGoalsPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("/me/goals page", () => {
  it("renders the Mål heading, the goals feature component and the shared personal navigation with Mål current", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Mål" })).toBeTruthy();
    expect(screen.getByTestId("goals-page")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Personlig utvikling" });
    const current = nav.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe("Mål");
  });

  it("passes the treeId parameter to the goals component (PG-11)", async () => {
    await renderPage({ treeId: "t-test" });
    expect(screen.getByTestId("goals-page").getAttribute("data-tree")).toBe("t-test");
  });

  it("ignores every other parameter", async () => {
    await renderPage({ title: "Lær Rust", role: "backend", uid: "u1" });
    expect(screen.getByTestId("goals-page").getAttribute("data-tree")).toBe("");
  });

  it("treats an empty or repeated treeId as absent", async () => {
    await renderPage({ treeId: "" });
    expect(screen.getByTestId("goals-page").getAttribute("data-tree")).toBe("");
    cleanup();
    await renderPage({ treeId: ["t-a", "t-b"] });
    expect(screen.getByTestId("goals-page").getAttribute("data-tree")).toBe("");
  });
});

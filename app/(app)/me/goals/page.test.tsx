// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../../src/components/ui/heading-structure";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/me/goals" }));
vi.mock("../../../../src/features/personal-goals/components/GoalsPage", () => ({
  GoalsPage: (props: { initialTreeId?: string }) => <div data-testid="goals-page" data-tree={props.initialTreeId ?? ""} />,
}));

const { default: MyGoalsPage } = await import("./page");

afterEach(cleanup);

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await MyGoalsPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("/me/goals page", () => {
  it("renders the Mål heading and the goals feature component, without a duplicate page-level nav", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Mine mål" })).toBeTruthy();
    expect(screen.getByTestId("goals-page")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Personlig utvikling" })).toBeNull();
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

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    render(await MyGoalsPage({ searchParams: Promise.resolve({}) }));
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../src/components/ui/heading-structure";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../../src/features/teams/components/TeamsOverview", () => ({
  TeamsOverview: () => <div data-testid="teams-overview" />,
}));

const { default: TeamsPage } = await import("./page");

describe("/teams page", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the Team heading and the directory", () => {
    render(<TeamsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Team" })).toBeTruthy();
    expect(screen.getByTestId("teams-overview")).toBeTruthy();
  });

  it("has one level-1 page title and a valid hierarchy (visual-redesign TASK-019)", () => {
    render(<TeamsPage />);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    render(<TeamsPage />);
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

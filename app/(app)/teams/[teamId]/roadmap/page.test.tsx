// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectMainLandmark, expectNamedControls } from "../../../../../src/components/ui/heading-structure";
import { cleanup } from "@testing-library/react";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

const roadmapPageMock = vi.fn<(props: { teamId: string }) => ReactElement>(() => (
  <div data-testid="roadmap-page" />
));

vi.mock("../../../../../src/features/roadmap/components/RoadmapPage", () => ({
  RoadmapPage: roadmapPageMock,
}));

const { default: TeamRoadmapPage } = await import("./page");

describe("TeamRoadmapPage", () => {
  it("renders RoadmapPage with the awaited teamId param inside a main landmark", async () => {
    render(await TeamRoadmapPage({ params: Promise.resolve({ teamId: "team-1" }) }));

    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByTestId("roadmap-page")).toBeTruthy();
    expect(roadmapPageMock.mock.calls[0]?.[0]).toEqual({ teamId: "team-1" });
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark; the page title is checked in the composed view's suite", async () => {
    render(await TeamRoadmapPage({ params: Promise.resolve({ teamId: "team-1" }) }));
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    // The page title is owned by the composed client view; its heading structure is checked in that view's suite.
  });
});

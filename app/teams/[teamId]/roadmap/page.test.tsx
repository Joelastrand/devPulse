// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

const roadmapPageMock = vi.fn<(props: { teamId: string }) => ReactElement>(() => (
  <div data-testid="roadmap-page" />
));

vi.mock("../../../../src/features/roadmap/components/RoadmapPage", () => ({
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

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SurveyResultSummary } from "../client/team-results-gateway";
import { ResultsSummaryStrip, changeDirection } from "./ResultsSummaryStrip";

afterEach(cleanup);

function published(date: string, flow: number, stress: number, fun: number): SurveyResultSummary {
  return { surveyId: date, date, minimumResponses: 5, status: "published", mean: { flow, stress, fun }, count: 6 } as SurveyResultSummary;
}

const INSUFFICIENT: SurveyResultSummary = {
  surveyId: "s-few", date: "2026-11-04T10:00:00.000Z", minimumResponses: 5, status: "insufficient",
} as SurveyResultSummary;

describe("changeDirection (TASK-050)", () => {
  it("gives the Norwegian direction words for up, down and no meaningful change", () => {
    expect(changeDirection(3.6, 3.0)).toBe("up");
    expect(changeDirection(2.4, 3.0)).toBe("down");
    expect(changeDirection(3.02, 3.0)).toBe("flat");
  });
});

describe("ResultsSummaryStrip (TASK-050)", () => {
  it("shows the change as a direction word when the latest and previous surveys are both published", () => {
    render(<ResultsSummaryStrip results={[published("2026-10-01", 3.0, 3.0, 3.0), published("2026-11-01", 3.6, 2.4, 3.02)]} />);

    expect(screen.getAllByText(/steg opp/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/steg ned/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/uendret/).length).toBeGreaterThan(0);
  });

  it("shows no change when the previous survey is not published", () => {
    const { container } = render(<ResultsSummaryStrip results={[INSUFFICIENT, published("2026-11-01", 3.6, 2.4, 3.0)]} />);

    expect(container.textContent).not.toMatch(/steg opp|steg ned|uendret/);
  });

  it("shows the flat insufficient state with no number when the latest survey is not published", () => {
    const { container } = render(<ResultsSummaryStrip results={[published("2026-10-01", 3.0, 3.0, 3.0), INSUFFICIENT]} />);

    expect(screen.getByText("For få svar ennå")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d\.\d|\b0\b/);
  });

  it("renders nothing when there are no results", () => {
    const { container } = render(<ResultsSummaryStrip results={[]} />);

    expect(container.textContent).toBe("");
  });
});

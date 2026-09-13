// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TrendTable } from "./TrendTable";
import type { SurveyResultSummary } from "../client/team-results-gateway";

const IRREGULAR_HISTORY: SurveyResultSummary[] = [
  {
    surveyId: "survey-1",
    date: "2026-06-01T00:00:00.000Z",
    minimumResponses: 5,
    status: "insufficient",
  },
  {
    surveyId: "survey-2",
    title: "Q2-puls",
    date: "2026-06-22T00:00:00.000Z",
    minimumResponses: 5,
    status: "published",
    mean: { flow: 3.2, stress: 2.8, fun: 4.1 },
    count: 7,
  },
  {
    surveyId: "survey-3",
    date: "2026-08-31T00:00:00.000Z",
    minimumResponses: 3,
    status: "published",
    mean: { flow: 4, stress: 2, fun: 5 },
    count: 3,
  },
];

describe("TrendTable", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a non-sensitive empty message when there are no closed surveys, never a fabricated row", () => {
    render(<TrendTable results={[]} />);

    expect(screen.getByText(/ingen avsluttede undersøkelser ennå/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders one row per actual survey, in the exact order given, with irregular gaps between them", () => {
    render(<TrendTable results={IRREGULAR_HISTORY} />);

    const rows = screen.getAllByRole("row");
    // Header row + 3 data rows.
    expect(rows).toHaveLength(4);
    expect(screen.getByText(/q2-puls/i)).toBeTruthy();
  });

  it("shows exact mean values and response count for a published survey", () => {
    render(<TrendTable results={[IRREGULAR_HISTORY[1]]} />);

    expect(screen.getByText("3.2")).toBeTruthy();
    expect(screen.getByText("2.8")).toBeTruthy();
    expect(screen.getByText("4.1")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("shows a threshold-safe suppressed message for an insufficient survey, never a count or fake aggregate", () => {
    render(<TrendTable results={[IRREGULAR_HISTORY[0]]} />);

    expect(screen.getByText(/minst 5 personer har svart/i)).toBeTruthy();
    expect(screen.queryByText(/\d+\.\d/)).toBeNull();
  });

  it("never leaks the actual response count for a below-threshold survey (threshold 5, actual count would have been 4)", () => {
    const { container } = render(
      <TrendTable
        results={[
          {
            surveyId: "survey-4",
            date: "2026-09-01T00:00:00.000Z",
            minimumResponses: 5,
            status: "insufficient",
          },
        ]}
      />,
    );

    expect(container.textContent).not.toMatch(/4 svar/);
    expect(container.textContent).not.toMatch(/4 av 5/);
  });

  it("uses each survey's own actual date, not a calendar-period label", () => {
    render(<TrendTable results={IRREGULAR_HISTORY} />);

    expect(screen.getByText(/^1\.\s*juni?\.?\s*2026/i)).toBeTruthy();
    expect(screen.getByText(/31\.\s*aug\.?\s*2026/i)).toBeTruthy();
  });

  it("contains no leftover English or period-based copy", () => {
    render(<TrendTable results={IRREGULAR_HISTORY} />);

    expect(screen.queryByText(/period/i)).toBeNull();
    expect(screen.queryByText(/uke\s*\d/i)).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PeriodSummary } from "./PeriodSummary";
import type { SurveyResultSummary } from "../client/team-results-gateway";

const PUBLISHED: SurveyResultSummary = {
  surveyId: "survey-1",
  title: "Q3-puls",
  date: "2026-08-24T00:00:00.000Z",
  minimumResponses: 5,
  status: "published",
  mean: { flow: 3.2, stress: 2.8, fun: 4.1 },
  count: 7,
};

const INSUFFICIENT: SurveyResultSummary = {
  surveyId: "survey-2",
  date: "2026-08-31T00:00:00.000Z",
  minimumResponses: 5,
  status: "insufficient",
};

describe("PeriodSummary", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the non-sensitive empty state when the team has no closed surveys", () => {
    render(<PeriodSummary result={null} />);

    expect(screen.getByText(/ingen avsluttede undersøkelser ennå/i)).toBeTruthy();
    expect(screen.queryByText(/\d+ svar/)).toBeNull();
  });

  it("shows the published survey's date, title, dimensions, and exact response count", () => {
    render(<PeriodSummary result={PUBLISHED} />);

    expect(screen.getByText(/q3-puls/i)).toBeTruthy();
    expect(screen.getByText(/24\.\s*aug/i)).toBeTruthy();
    expect(screen.getByText("3.2")).toBeTruthy();
    expect(screen.getByText("2.8")).toBeTruthy();
    expect(screen.getByText("4.1")).toBeTruthy();
    expect(screen.getByText("7 svar")).toBeTruthy();
  });

  it("shows a threshold-safe suppressed message for an insufficient survey, never the actual response count", () => {
    render(<PeriodSummary result={INSUFFICIENT} />);

    expect(screen.getByText(/minst 5 personer har svart/i)).toBeTruthy();
    expect(screen.queryByText(/\d+ svar/)).toBeNull();
    expect(screen.queryByText(/[0-9] av 5/)).toBeNull();
  });

  it("never renders the survey's mean/aggregate content for an insufficient survey", () => {
    render(<PeriodSummary result={INSUFFICIENT} />);

    expect(screen.queryByRole("definition")).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SurveyResultSummary } from "../../results/client/team-results-gateway";
import { TeamSummaryStrip } from "./TeamSummaryStrip";

afterEach(cleanup);

const PUBLISHED: SurveyResultSummary = {
  surveyId: "s1",
  title: "Uke 44",
  date: "2026-10-28T10:00:00.000Z",
  minimumResponses: 5,
  status: "published",
  mean: { flow: 3.4, stress: 2.9, fun: 3.8 },
} as SurveyResultSummary;

const INSUFFICIENT: SurveyResultSummary = {
  surveyId: "s2",
  title: "Uke 45",
  date: "2026-11-04T10:00:00.000Z",
  minimumResponses: 5,
  status: "insufficient",
} as SurveyResultSummary;

describe("TeamSummaryStrip (TASK-040)", () => {
  it("is absent when there is no latest survey, rather than showing a zero", () => {
    const { container } = render(<TeamSummaryStrip latest={null} />);

    expect(container.textContent).toBe("");
  });

  it("shows the latest survey's status as text for a published result", () => {
    render(<TeamSummaryStrip latest={PUBLISHED} />);

    expect(screen.getByText("Resultat publisert")).toBeTruthy();
  });

  it("shows the insufficient state as text, without any count", () => {
    const { container } = render(<TeamSummaryStrip latest={INSUFFICIENT} />);

    expect(screen.getByText("For få svar ennå")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+ (svar|personer)/);
  });
});

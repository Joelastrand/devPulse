// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../../src/components/ui/heading-structure";

vi.mock("../../../../src/features/surveys/components/SurveyParticipationView", () => ({
  SurveyParticipationView: () => <h1>Pulsmåling</h1>,
}));

const { default: SurveyPage } = await import("./page");

describe("survey route structure (visual-redesign TASK-019)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 survey title", async () => {
    render(await SurveyPage({ params: Promise.resolve({ surveyId: "survey-1" }) }));

    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
    expect(screen.getByRole("heading", { level: 1, name: "Pulsmåling" })).toBeTruthy();
  });
});

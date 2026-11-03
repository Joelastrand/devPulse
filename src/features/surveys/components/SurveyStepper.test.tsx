// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SurveyResponseForm } from "./SurveyResponseForm";

function next() {
  return screen.getByRole("button", { name: "Neste" });
}

function back() {
  return screen.getByRole("button", { name: "Tilbake" });
}

describe("SurveyResponseForm one-question stepper (TASK-021)", () => {
  afterEach(cleanup);

  it("shows one question at a time with 'Spørsmål N av 3' progress text", () => {
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    expect(screen.getByText("Spørsmål 1 av 3")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Arbeidsflyt og leveransetilfredshet" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Glede og motivasjon" })).toBeNull();
  });

  it("disables Next until the current question is answered, and says why in text", async () => {
    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    expect(next().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Velg et svar for å fortsette")).toBeTruthy();

    await user.click(screen.getByLabelText("4", { selector: "#flow-4" }));

    expect(next().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("Velg et svar for å fortsette")).toBeNull();
  });

  it("keeps the answer when Back is pressed, and Back never clears it", async () => {
    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    await user.click(screen.getByLabelText("4", { selector: "#flow-4" }));
    await user.click(next());
    await user.click(back());

    expect(screen.getByText("Spørsmål 1 av 3")).toBeTruthy();
    expect((screen.getByLabelText("4", { selector: "#flow-4" }) as HTMLInputElement).checked).toBe(true);
  });

  it("preserves all three values across forward and backward navigation", async () => {
    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    await user.click(screen.getByLabelText("1", { selector: "#flow-1" }));
    await user.click(next());
    await user.click(screen.getByLabelText("2", { selector: "#stress-2" }));
    await user.click(next());
    await user.click(screen.getByLabelText("3", { selector: "#fun-3" }));
    await user.click(next());
    await user.click(back());
    await user.click(back());
    await user.click(back());

    expect((screen.getByLabelText("1", { selector: "#flow-1" }) as HTMLInputElement).checked).toBe(true);
    await user.click(next());
    expect((screen.getByLabelText("2", { selector: "#stress-2" }) as HTMLInputElement).checked).toBe(true);
    await user.click(next());
    expect((screen.getByLabelText("3", { selector: "#fun-3" }) as HTMLInputElement).checked).toBe(true);
  });

  it("disables Back on the first question", () => {
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    expect(back().hasAttribute("disabled")).toBe(true);
  });
});

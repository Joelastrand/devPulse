// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { surveysCopy } from "../copy";
import { SurveyIntro } from "./SurveyIntro";

const LOCKED_NOTICE =
  "Svaret ditt lagres uten navn eller e-postadresse. Teamet ser bare samlede resultater, og først når undersøkelsen er avsluttet og nok personer har svart.";

describe("SurveyIntro", () => {
  afterEach(cleanup);

  it("shows the survey title and team name on the intro screen", () => {
    render(<SurveyIntro title="Puls mars" teamName="Team Alfa" onStart={() => {}} />);

    expect(screen.getByRole("heading", { level: 1, name: "Puls mars" })).toBeTruthy();
    expect(screen.getByText("Team Alfa")).toBeTruthy();
  });

  it("shows the locked privacy notice verbatim, visible without any action", () => {
    const { container } = render(<SurveyIntro title="Puls" teamName="Team Alfa" onStart={() => {}} />);

    const notice = Array.from(container.querySelectorAll("p")).find((p) => p.textContent === LOCKED_NOTICE);
    expect(notice).toBeTruthy();
    expect(surveysCopy.intro.notice).toBe(LOCKED_NOTICE);
  });

  it("keeps the disclosure collapsed by default and opens it from its native summary", async () => {
    const user = userEvent.setup();
    const { container } = render(<SurveyIntro title="Puls" teamName="Team Alfa" onStart={() => {}} />);

    const details = container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);

    await user.click(screen.getByText("Mer om personvernet"));

    expect(details?.hasAttribute("open")).toBe(true);
  });

  it("lists the five disclosure points in SPEC order, verbatim", () => {
    const { container } = render(<SurveyIntro title="Puls" teamName="Team Alfa" onStart={() => {}} />);

    const items = Array.from(container.querySelectorAll("details ol li")).map((item) => item.textContent);
    expect(items).toEqual([
      "DevPulse viser aldri enkeltsvar, og viser ikke hvem som har svart.",
      "Undersøkelser for teamet krever innlogging og medlemskap. Da kan du bare svare én gang.",
      "Undersøkelser som er åpne for alle med lenken, krever ikke innlogging. Da kan DevPulse ikke hindre at samme person svarer flere ganger, og svarene kan ikke knyttes til en person i DevPulse.",
      "Resultatene vises først når undersøkelsen er avsluttet og minst det angitte antallet personer har svart. Før det vises ingen tall.",
      "Svar som ikke er sendt inn, lagres ikke. Har du ikke sendt inn, må du åpne siden på nytt og svare igjen.",
    ]);
  });

  it("never uses the word anonym and names no digit threshold in the notice or disclosure", () => {
    const { container } = render(<SurveyIntro title="Puls" teamName="Team Alfa" onStart={() => {}} />);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/anonym/i);
    expect(surveysCopy.intro.notice).not.toMatch(/\d/);
    for (const point of surveysCopy.intro.disclosurePoints) {
      expect(point).not.toMatch(/\d/);
    }
  });

  it("starts the survey when the Start action is pressed", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<SurveyIntro title="Puls" teamName="Team Alfa" onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: "Start" }));

    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

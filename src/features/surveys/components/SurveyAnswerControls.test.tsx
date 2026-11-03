// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SurveyResponseForm } from "./SurveyResponseForm";

async function answerAndGo(user: ReturnType<typeof userEvent.setup>, value: number, questionId: string) {
  await user.click(screen.getByLabelText(String(value), { selector: `#${questionId}-${value}` }));
  await user.click(screen.getByRole("button", { name: "Neste" }));
}

describe("survey answer controls (TASK-022)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("gives each of the five answer controls a 44 px minimum target on mobile", () => {
    const { container } = render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    const labels = Array.from(container.querySelectorAll("fieldset label"));
    expect(labels).toHaveLength(5);
    for (const label of labels) {
      expect(label.className).toContain("min-h-11");
      expect(label.className).toContain("min-w-11");
    }
  });

  it("marks the selected answer with a border and text, not colour alone", async () => {
    const user = userEvent.setup();
    const { container } = render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    await user.click(screen.getByLabelText("4", { selector: "#flow-4" }));

    const selected = container.querySelector('label[for="flow-4"]')?.className ?? "";
    const other = container.querySelector('label[for="flow-2"]')?.className ?? "";
    expect(selected).toContain("border-primary");
    expect(selected).toContain("text-primary");
    expect(other).not.toContain("border-primary");
  });

  it("moves through the radio group with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    const first = screen.getByLabelText("1", { selector: "#flow-1" }) as HTMLInputElement;
    first.focus();
    await user.click(first);
    await user.keyboard("{ArrowRight}");

    const second = screen.getByLabelText("2", { selector: "#flow-2" }) as HTMLInputElement;
    expect(second.checked).toBe(true);
    expect(document.activeElement).toBe(second);
  });

  it("lists the three answers as text on the review step, with the submit action", async () => {
    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    await answerAndGo(user, 4, "flow");
    await answerAndGo(user, 2, "stress");
    await answerAndGo(user, 5, "fun");

    const review = screen.getByRole("list", { name: "Gjennomgå svarene" });
    expect(within(review).getByText("Arbeidsflyt og leveransetilfredshet").closest("li")?.textContent).toContain("4");
    expect(within(review).getByText("Bærekraftig arbeidsmengde og stress").closest("li")?.textContent).toContain("2");
    expect(within(review).getByText("Glede og motivasjon").closest("li")?.textContent).toContain("5");
    expect(screen.getByRole("button", { name: /send inn/i })).toBeTruthy();
  });

  it("submits exactly the ordered payload [flow, stress, fun] after review", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    await answerAndGo(user, 4, "flow");
    await answerAndGo(user, 2, "stress");
    await answerAndGo(user, 5, "fun");
    await user.click(screen.getByRole("button", { name: /send inn/i }));

    await screen.findByRole("status");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({ answers: [4, 2, 5] });
  });
});

describe("survey completion state (TASK-023)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("replaces the stepper with the existing success copy after a successful submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 })));
    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    await answerAndGo(user, 4, "flow");
    await answerAndGo(user, 2, "stress");
    await answerAndGo(user, 5, "fun");
    await user.click(screen.getByRole("button", { name: /send inn/i }));

    expect((await screen.findByRole("status")).textContent).toBe("Takk — svaret ditt ble registrert.");
    expect(screen.queryByRole("button", { name: "Neste" })).toBeNull();
    expect(screen.queryByText(/spørsmål \d av 3/i)).toBeNull();
  });
});

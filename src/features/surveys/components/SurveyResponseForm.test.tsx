// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SurveyResponseForm } from "./SurveyResponseForm";

function submitButton() {
  return screen.getByRole("button", { name: /send inn/i });
}

async function fillAllFields(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("1", { selector: "#flow-1" }));
  await user.click(screen.getByLabelText("2", { selector: "#stress-2" }));
  await user.click(screen.getByLabelText("3", { selector: "#fun-3" }));
}

describe("SurveyResponseForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders exactly three questions and no team selector, in Norwegian", () => {
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    expect(screen.getByRole("group", { name: "Arbeidsflyt og leveransetilfredshet" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Bærekraftig arbeidsmengde og stress" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Glede og motivasjon" })).toBeTruthy();
    expect(screen.queryByLabelText("Team")).toBeNull();
  });

  it("disables submission until all three answers are selected", async () => {
    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    expect(submitButton().hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByLabelText("1", { selector: "#flow-1" }));
    expect(submitButton().hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByLabelText("2", { selector: "#stress-2" }));
    expect(submitButton().hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByLabelText("3", { selector: "#fun-3" }));
    expect(submitButton().hasAttribute("disabled")).toBe(false);
  });

  it("submits without an Authorization header for a public survey (idToken null)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);
    await fillAllFields(user);
    await user.click(submitButton());

    await screen.findByRole("status");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/surveys/survey-1/responses",
      expect.objectContaining({ headers: { "content-type": "application/json" } }),
    );
  });

  it("submits with a bearer Authorization header for an authenticated survey", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken="a-token" />);
    await fillAllFields(user);
    await user.click(submitButton());

    await screen.findByRole("status");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/surveys/survey-1/responses",
      expect.objectContaining({
        headers: { "content-type": "application/json", Authorization: "Bearer a-token" },
      }),
    );
  });

  it("shows a Norwegian confirmation via role=status after a successful submission", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);
    await fillAllFields(user);
    await user.click(submitButton());

    const confirmation = await screen.findByRole("status");
    expect(confirmation.textContent).toMatch(/registrert/i);
  });

  it("shows a distinct Norwegian 'already submitted' notice, not the generic error, for an already_submitted rejection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "already_submitted" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken="a-token" />);
    await fillAllFields(user);
    await user.click(submitButton());

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/allerede svart/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a generic Norwegian error via role=alert and does not claim success when submission fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "invalid_submission" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);
    await fillAllFields(user);
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a pending label and marks the button aria-busy while submitting", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);
    await fillAllFields(user);
    await user.click(submitButton());

    const pendingButton = screen.getByRole("button", { name: /sender inn/i });
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");

    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await screen.findByRole("status");
  });

  it("contains no leftover English copy", () => {
    render(<SurveyResponseForm surveyId="survey-1" idToken={null} />);

    expect(screen.queryByText(/delivery satisfaction/i)).toBeNull();
    expect(screen.queryByText(/sustainable workload/i)).toBeNull();
    expect(screen.queryByText(/motivation/i)).toBeNull();
    expect(screen.queryByText(/^submit$/i)).toBeNull();
  });
});

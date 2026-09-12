// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PulseSurveyForm } from "./PulseSurveyForm";

const TEAMS = [
  { teamId: "platform", name: "Platform" },
  { teamId: "web-app", name: "Web App" },
];

function submitButton() {
  return screen.getByRole("button", { name: /send inn/i });
}

async function fillAllFields(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("1", { selector: "#flow-1" }));
  await user.click(screen.getByLabelText("2", { selector: "#stress-2" }));
  await user.click(screen.getByLabelText("3", { selector: "#fun-3" }));
  await user.selectOptions(
    screen.getByLabelText("Team"),
    "platform",
  );
}

describe("PulseSurveyForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders exactly three questions and a team select, in Norwegian", () => {
    render(<PulseSurveyForm teams={TEAMS} />);

    expect(
      screen.getByRole("group", { name: "Arbeidsflyt og leveransetilfredshet" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "Bærekraftig arbeidsmengde og stress" }),
    ).toBeTruthy();
    expect(screen.getByRole("group", { name: "Glede og motivasjon" })).toBeTruthy();
    expect(screen.getByLabelText("Team")).toBeTruthy();
  });

  it("disables submission until all three answers and a team are selected", async () => {
    const user = userEvent.setup();
    render(<PulseSurveyForm teams={TEAMS} />);

    expect(submitButton().hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByLabelText("1", { selector: "#flow-1" }));
    expect(submitButton().hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByLabelText("2", { selector: "#stress-2" }));
    expect(submitButton().hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByLabelText("3", { selector: "#fun-3" }));
    expect(submitButton().hasAttribute("disabled")).toBe(true);

    await user.selectOptions(screen.getByLabelText("Team"), "platform");
    expect(submitButton().hasAttribute("disabled")).toBe(false);
  });

  it("shows a Norwegian confirmation via role=status after a successful submission", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<PulseSurveyForm teams={TEAMS} />);
    await fillAllFields(user);
    await user.click(submitButton());

    const confirmation = await screen.findByRole("status");
    expect(confirmation.textContent).toMatch(/registrert/i);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pulse-survey",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows a generic Norwegian error via role=alert and does not claim success when submission fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_submission" }), {
          status: 400,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<PulseSurveyForm teams={TEAMS} />);
    await fillAllFields(user);
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("disables the team selector and submission, and shows a Norwegian unavailable notice, when the active-team read failed", () => {
    render(<PulseSurveyForm teams={[]} teamsUnavailable />);

    expect(screen.getByLabelText("Team").hasAttribute("disabled")).toBe(true);
    expect(submitButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/utilgjengelig/i);
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
    render(<PulseSurveyForm teams={TEAMS} />);
    await fillAllFields(user);
    await user.click(submitButton());

    const pendingButton = screen.getByRole("button", { name: /sender inn/i });
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");

    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await screen.findByRole("status");
  });

  it("contains no leftover English copy", () => {
    render(<PulseSurveyForm teams={TEAMS} teamsUnavailable />);

    expect(screen.queryByText(/delivery satisfaction/i)).toBeNull();
    expect(screen.queryByText(/sustainable workload/i)).toBeNull();
    expect(screen.queryByText(/motivation/i)).toBeNull();
    expect(screen.queryByText(/currently unavailable/i)).toBeNull();
    expect(screen.queryByText(/^submit$/i)).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PulseSurveyForm } from "./PulseSurveyForm";

function submitButton() {
  return screen.getByRole("button", { name: /submit/i });
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

  it("renders exactly three questions and a team select", () => {
    render(<PulseSurveyForm />);

    expect(
      screen.getByRole("group", { name: "Flow / delivery satisfaction" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "Stress / sustainable workload" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "Fun / motivation" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Team")).toBeTruthy();
  });

  it("disables submission until all three answers and a team are selected", async () => {
    const user = userEvent.setup();
    render(<PulseSurveyForm />);

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

  it("shows a confirmation after a successful submission", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<PulseSurveyForm />);
    await fillAllFields(user);
    await user.click(submitButton());

    const confirmation = await screen.findByRole("status");
    expect(confirmation.textContent).toMatch(/recorded/i);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pulse-survey",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows a generic error and does not claim success when submission fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_submission" }), {
          status: 400,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<PulseSurveyForm />);
    await fillAllFields(user);
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

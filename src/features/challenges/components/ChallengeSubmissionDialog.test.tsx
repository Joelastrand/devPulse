// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChallengeSubmissionDialog } from "./ChallengeSubmissionDialog";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function openButton() {
  return screen.getByRole("button", { name: "Meld inn utfordring" });
}

describe("ChallengeSubmissionDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens a labelled modal dialog with the first field focused", async () => {
    const user = userEvent.setup();
    render(<ChallengeSubmissionDialog idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);

    await user.click(openButton());

    const dialog = screen.getByRole("dialog", { name: "Meld inn utfordring" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Utfordring"));
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<ChallengeSubmissionDialog idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);

    await user.click(openButton());
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(openButton());
  });

  it("closes with Avbryt without sending anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ChallengeSubmissionDialog idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);

    await user.click(openButton());
    await user.click(screen.getByRole("button", { name: "Avbryt" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits through the existing route, notifies the caller, and shows success with Lukk", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { ok: true })));
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    render(<ChallengeSubmissionDialog idToken="token-1" teamId="team-1" onSubmitted={onSubmitted} />);

    await user.click(openButton());
    await user.type(screen.getByLabelText("Utfordring"), "Deploy owner is unclear");
    await user.click(screen.getByRole("button", { name: "Send inn" }));

    expect((await screen.findByRole("status")).textContent).toMatch(/registrert/i);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Lukk" })).toBeTruthy();
  });

  it("keeps the entered text and shows an error when the submission fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "persistence_failed" })));
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    render(<ChallengeSubmissionDialog idToken="token-1" teamId="team-1" onSubmitted={onSubmitted} />);

    await user.click(openButton());
    await user.type(screen.getByLabelText("Utfordring"), "Deploy owner is unclear");
    await user.click(screen.getByRole("button", { name: "Send inn" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/noe gikk galt/i);
    expect((screen.getByLabelText("Utfordring") as HTMLTextAreaElement).value).toBe("Deploy owner is unclear");
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});

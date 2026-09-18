// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReplyForm } from "./ReplyForm";

function bodyField() {
  return screen.getByLabelText("Svar");
}

function submitButton() {
  return screen.getByRole("button", { name: /^send svar$/i });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("ReplyForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("has a real associated label for the body field", () => {
    render(<ReplyForm idToken="token-1" teamId="team-1" threadId="thread-1" onSubmitted={() => {}} />);

    expect(bodyField().tagName).toBe("TEXTAREA");
  });

  it("shows a client-side validation error for too-short text without calling the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ReplyForm idToken="token-1" teamId="team-1" threadId="thread-1" onSubmitted={() => {}} />);
    await user.type(bodyField(), "hi");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/3–2000/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only the body field to the thread-scoped replies route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ReplyForm idToken="token-1" teamId="team-9" threadId="thread-9" onSubmitted={() => {}} />);
    await user.type(bodyField(), "Et gyldig svar på tråden.");
    await user.click(submitButton());

    await screen.findByRole("status");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/teams/team-9/forum/threads/thread-9/replies");
    expect(JSON.parse(init.body as string)).toEqual({ body: "Et gyldig svar på tråden." });
  });

  it("shows a success confirmation, moves focus to it, and calls onSubmitted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { ok: true })));
    const onSubmitted = vi.fn();

    const user = userEvent.setup();
    render(<ReplyForm idToken="token-1" teamId="team-1" threadId="thread-1" onSubmitted={onSubmitted} />);
    await user.type(bodyField(), "Et gyldig svar på tråden.");
    await user.click(submitButton());

    const confirmation = await screen.findByRole("status");
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(confirmation.parentElement);
  });

  it("allows submitting another reply after a success confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { ok: true })));

    const user = userEvent.setup();
    render(<ReplyForm idToken="token-1" teamId="team-1" threadId="thread-1" onSubmitted={() => {}} />);
    await user.type(bodyField(), "Et gyldig svar på tråden.");
    await user.click(submitButton());
    await screen.findByRole("status");

    await user.click(screen.getByRole("button", { name: /skriv et nytt svar/i }));

    expect(bodyField()).toBeTruthy();
  });

  it("renders a disabled, explanatory state once the server reports thread_full, instead of the form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "thread_full" })));

    const user = userEvent.setup();
    render(<ReplyForm idToken="token-1" teamId="team-1" threadId="thread-1" onSubmitted={() => {}} />);
    await user.type(bodyField(), "Et gyldig svar på tråden.");
    await user.click(submitButton());

    await screen.findByText(/500 svar/i);
    expect(screen.queryByLabelText("Svar")).toBeNull();
  });

  it("shows one generic infrastructure-failure message for persistence_failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "persistence_failed" })));

    const user = userEvent.setup();
    render(<ReplyForm idToken="token-1" teamId="team-1" threadId="thread-1" onSubmitted={() => {}} />);
    await user.type(bodyField(), "Et gyldig svar på tråden.");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
  });
});

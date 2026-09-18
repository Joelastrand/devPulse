// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateThreadForm } from "./CreateThreadForm";

function titleField() {
  return screen.getByLabelText("Tittel");
}

function bodyField() {
  return screen.getByLabelText("Innhold");
}

function submitButton() {
  return screen.getByRole("button", { name: /^opprett tråd$/i });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("CreateThreadForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("has real associated labels for the title and body fields", () => {
    render(<CreateThreadForm idToken="token-1" teamId="team-1" onCreated={() => {}} />);

    expect(titleField().tagName).toBe("INPUT");
    expect(bodyField().tagName).toBe("TEXTAREA");
  });

  it("shows a client-side validation error for a too-short title without calling the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<CreateThreadForm idToken="token-1" teamId="team-1" onCreated={() => {}} />);
    await user.type(titleField(), "hi");
    await user.type(bodyField(), "En gyldig lengde på innholdet.");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/3–150/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(titleField().getAttribute("aria-invalid")).toBe("true");
  });

  it("sends only title/body — never an identity/scope/lifecycle field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true, threadId: "thread-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<CreateThreadForm idToken="token-1" teamId="team-9" onCreated={() => {}} />);
    await user.type(titleField(), "En helt ny tråd");
    await user.type(bodyField(), "Med et gyldig innhold i tråden.");
    await user.click(submitButton());

    await screen.findByRole("status");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/teams/team-9/forum/threads");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual({ title: "En helt ny tråd", body: "Med et gyldig innhold i tråden." });
    expect(init.headers).toMatchObject({ Authorization: "Bearer token-1" });
  });

  it("calls onCreated with the generated threadId and moves focus to the confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { ok: true, threadId: "thread-42" })));
    const onCreated = vi.fn();

    const user = userEvent.setup();
    render(<CreateThreadForm idToken="token-1" teamId="team-1" onCreated={onCreated} />);
    await user.type(titleField(), "En helt ny tråd");
    await user.type(bodyField(), "Med et gyldig innhold i tråden.");
    await user.click(submitButton());

    const confirmation = await screen.findByRole("status");
    expect(onCreated).toHaveBeenCalledWith("thread-42");
    expect(document.activeElement).toBe(confirmation.parentElement);
  });

  it("shows a specific team-disabled message for a team_disabled rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "team_disabled" })));

    const user = userEvent.setup();
    render(<CreateThreadForm idToken="token-1" teamId="team-1" onCreated={() => {}} />);
    await user.type(titleField(), "En helt ny tråd");
    await user.type(bodyField(), "Med et gyldig innhold i tråden.");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/deaktivert/i);
  });

  it("shows one generic infrastructure-failure message for encryption_failed, without exposing the distinction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "encryption_failed" })));

    const user = userEvent.setup();
    render(<CreateThreadForm idToken="token-1" teamId="team-1" onCreated={() => {}} />);
    await user.type(titleField(), "En helt ny tråd");
    await user.type(bodyField(), "Med et gyldig innhold i tråden.");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    expect(alert.textContent?.toLowerCase()).not.toMatch(/encryption/);
  });

  it("shows the server-side validation-error message for a server-rejected invalid_input, and never claims success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_input" })));

    const user = userEvent.setup();
    render(<CreateThreadForm idToken="token-1" teamId="team-1" onCreated={() => {}} />);
    await user.type(titleField(), "Gyldig lengde tittel");
    await user.type(bodyField(), "Gyldig lengde på innholdet men serveren avviser likevel.");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/3–150/);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

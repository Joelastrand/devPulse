// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChallengeSubmissionPanel } from "./ChallengeSubmissionPanel";

function submitButton() {
  return screen.getByRole("button", { name: /send inn/i });
}

function textarea() {
  return screen.getByLabelText(/utfordring/i);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("ChallengeSubmissionPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a heading, the anonymity explanation, and the identity warning", () => {
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);

    expect(screen.getByRole("heading", { name: "Meld en utfordring" })).toBeTruthy();
    expect(screen.getByText(/anonym/i)).toBeTruthy();
    expect(screen.getByText(/ikke inkluder navn/i)).toBeTruthy();
  });

  it("has a real associated label for the textarea", () => {
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);

    const field = textarea();
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("shows a client-side validation error for too-short text without calling the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);
    await user.type(textarea(), "hi");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/3 og 2000/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(textarea().getAttribute("aria-invalid")).toBe("true");
  });

  it("submits only the text field with a bearer token, and shows pending/aria-busy state", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-9" onSubmitted={() => {}} />);
    await user.type(textarea(), "Our deploy process has no clear owner");
    await user.click(submitButton());

    const pendingButton = screen.getByRole("button", { name: /sender inn/i });
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/teams/team-9/challenges");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Our deploy process has no clear owner" });
    expect(init.headers).toMatchObject({ Authorization: "Bearer token-1" });

    resolveFetch(jsonResponse(201, { ok: true }));
    await screen.findByRole("status");
  });

  it("never sends uid/email/displayName/membershipId/admin-state fields with the submission", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);
    await user.type(textarea(), "Code review regularly takes more than two days");
    await user.click(submitButton());

    await screen.findByRole("status");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(init.body as string);
    expect(Object.keys(sentBody)).toEqual(["text"]);
  });

  it("shows a success confirmation via role=status and calls onSubmitted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { ok: true })));
    const onSubmitted = vi.fn();

    const user = userEvent.setup();
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-1" onSubmitted={onSubmitted} />);
    await user.type(textarea(), "Our deploy process has no clear owner");
    await user.click(submitButton());

    const confirmation = await screen.findByRole("status");
    expect(confirmation.textContent).toMatch(/registrert/i);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/utfordring/i)).toBeNull();
  });

  it("moves focus to the success confirmation after a successful submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { ok: true })));

    const user = userEvent.setup();
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);
    await user.type(textarea(), "Our deploy process has no clear owner");
    await user.click(submitButton());

    const confirmation = await screen.findByRole("status");
    expect(document.activeElement).toBe(confirmation.parentElement);
  });

  it("shows a specific team-disabled message for a team_disabled rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "team_disabled" })));

    const user = userEvent.setup();
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);
    await user.type(textarea(), "Our deploy process has no clear owner");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/deaktivert/i);
  });

  it("shows one generic infrastructure-failure message for encryption_failed, without exposing the distinction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "encryption_failed" })));

    const user = userEvent.setup();
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);
    await user.type(textarea(), "Our deploy process has no clear owner");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    expect(alert.textContent?.toLowerCase()).not.toMatch(/encryption/);
  });

  it("shows the same generic infrastructure-failure message for persistence_failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "persistence_failed" })));

    const user = userEvent.setup();
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);
    await user.type(textarea(), "Our deploy process has no clear owner");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
  });

  it("shows the server-side validation-error message for a server-rejected invalid_input, and never claims success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_input" })));

    const user = userEvent.setup();
    // Bypass client-side validation by typing valid-length text so the request reaches the server mock.
    render(<ChallengeSubmissionPanel idToken="token-1" teamId="team-1" onSubmitted={() => {}} />);
    await user.type(textarea(), "Valid length text but server rejects anyway");
    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/3 og 2000/);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

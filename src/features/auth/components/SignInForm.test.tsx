// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signInMock = vi.fn();

vi.mock("../client/auth-client", () => ({
  signIn: signInMock,
}));

const { SignInForm } = await import("./SignInForm");

describe("SignInForm", () => {
  afterEach(() => {
    cleanup();
    signInMock.mockReset();
  });

  it("submits the entered email and password", async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    expect(signInMock).toHaveBeenCalledWith(
      "dev@example.com",
      "correct horse battery",
    );
  });

  it("shows a Norwegian success message linking to /teams on success", async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/du er logget inn/i);
    const link = screen.getByRole("link", { name: /fortsett til team/i });
    expect(link.getAttribute("href")).toBe("/teams");
  });

  it("shows a Norwegian error message for invalid credentials", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "invalid_credentials" });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ugyldig e-post eller passord/i);
  });

  it("shows a pending label and marks the button aria-busy while submitting", async () => {
    let resolveSignIn: (value: { ok: true }) => void = () => {};
    signInMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignIn = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    const pendingButton = screen.getByRole("button", { name: /logger inn/i });
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");

    resolveSignIn({ ok: true });
    await screen.findByRole("status");
  });

  it("contains no leftover English copy", () => {
    render(<SignInForm />);

    expect(screen.queryByText(/^email$/i)).toBeNull();
    expect(screen.queryByText(/^password$/i)).toBeNull();
    expect(screen.queryByText(/^sign in$/i)).toBeNull();
  });

  it("redirects to a valid survey continuation after successful sign-in", async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SignInForm continuation="/survey/abc123" />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/du er logget inn/i);
    const link = screen.getByRole("link", { name: /fortsett til undersøkelsen/i });
    expect(link.getAttribute("href")).toBe("/survey/abc123");
  });

  it.each([
    ["https://evil.example", "an external URL"],
    ["//evil.example", "a protocol-relative URL"],
    ["/admin/teams", "an unrelated internal route"],
    ["/survey/a/b", "a malformed survey path"],
  ])("falls back to /teams when the continuation is %s (%s)", async (continuation) => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SignInForm continuation={continuation} />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    await screen.findByRole("status");
    const link = screen.getByRole("link", { name: /fortsett til team/i });
    expect(link.getAttribute("href")).toBe("/teams");
    expect(link.getAttribute("href")).not.toBe(continuation);
  });

  it("never redirects anywhere when sign-in fails, even with a valid survey continuation", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "invalid_credentials" });
    const user = userEvent.setup();
    render(<SignInForm continuation="/survey/abc123" />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /logg inn/i }));

    await screen.findByRole("alert");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

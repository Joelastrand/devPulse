// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signUpMock = vi.fn();

vi.mock("../client/auth-client", () => ({
  signUp: signUpMock,
}));

const { SignUpForm } = await import("./SignUpForm");

describe("SignUpForm", () => {
  afterEach(() => {
    cleanup();
    signUpMock.mockReset();
  });

  it("submits the entered email and password", async () => {
    signUpMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /opprett konto/i }));

    expect(signUpMock).toHaveBeenCalledWith(
      "dev@example.com",
      "correct horse battery",
    );
  });

  it("shows a Norwegian verification-email message on success", async () => {
    signUpMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /opprett konto/i }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/bekreftelseslenke/i);
  });

  it("shows a Norwegian error message when sign-up fails", async () => {
    signUpMock.mockResolvedValue({ ok: false, error: "sign_up_failed" });
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /opprett konto/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
  });

  it("shows a pending label and marks the button aria-busy while submitting", async () => {
    let resolveSignUp: (value: { ok: true }) => void = () => {};
    signUpMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignUp = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("E-post"), "dev@example.com");
    await user.type(screen.getByLabelText("Passord"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /opprett konto/i }));

    const pendingButton = screen.getByRole("button", { name: /oppretter konto/i });
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");

    resolveSignUp({ ok: true });
    await screen.findByRole("status");
  });

  it("contains no leftover English copy", () => {
    render(<SignUpForm />);

    expect(screen.queryByText(/^email$/i)).toBeNull();
    expect(screen.queryByText(/^password$/i)).toBeNull();
    expect(screen.queryByText(/^sign up$/i)).toBeNull();
  });
});

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

    await user.type(screen.getByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /sign up/i }));

    expect(signUpMock).toHaveBeenCalledWith(
      "dev@example.com",
      "correct horse battery",
    );
  });

  it("shows a verification-email message on success", async () => {
    signUpMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /sign up/i }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/verification link/i);
  });

  it("shows an error message when sign-up fails", async () => {
    signUpMock.mockResolvedValue({ ok: false, error: "sign_up_failed" });
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /sign up/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

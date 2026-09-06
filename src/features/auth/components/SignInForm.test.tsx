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

    await user.type(screen.getByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(signInMock).toHaveBeenCalledWith(
      "dev@example.com",
      "correct horse battery",
    );
  });

  it("shows a success message on success", async () => {
    signInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/signed in/i);
    const link = screen.getByRole("link", { name: /continue to your results/i });
    expect(link.getAttribute("href")).toBe("/results");
  });

  it("shows an error message for invalid credentials", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "invalid_credentials" });
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/invalid email or password/i);
  });
});

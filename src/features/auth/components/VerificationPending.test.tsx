// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
const resendMock = vi.fn();
const signOutMock = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn() }) }));
vi.mock("../client/auth-client", () => ({
  resendVerificationEmail: resendMock,
  signOut: signOutMock,
}));

const { VerificationPending } = await import("./VerificationPending");

describe("VerificationPending", () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
    resendMock.mockReset();
    signOutMock.mockReset();
  });

  it("explains the next step and includes the spam-folder reminder", () => {
    render(<VerificationPending variant="created" />);

    expect(screen.getByRole("heading", { name: "Sjekk e-posten din" })).toBeTruthy();
    expect(screen.getByText(/søppelpost eller spam-mappen/i)).toBeTruthy();
  });

  it("signs the pending session out and navigates to the existing login route", async () => {
    signOutMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<VerificationPending variant="created" />);

    await user.click(screen.getByRole("button", { name: "Logg inn" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sign-in"));
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("on the sign-in page, signs out and returns to the form in place instead of pushing the same route", async () => {
    signOutMock.mockResolvedValue({ ok: true });
    const onReturnToSignIn = vi.fn();
    const user = userEvent.setup();
    render(<VerificationPending variant="unverified" onReturnToSignIn={onReturnToSignIn} />);

    await user.click(screen.getByRole("button", { name: "Logg inn" }));

    await waitFor(() => expect(onReturnToSignIn).toHaveBeenCalledTimes(1));
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("resends the link and then disables resend during the cooldown", async () => {
    resendMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<VerificationPending variant="created" />);

    await user.click(screen.getByRole("button", { name: "Send bekreftelseslenke på nytt" }));

    expect(await screen.findByRole("status")).toBeTruthy();
    const resend = screen.getByRole("button", { name: /send bekreftelseslenke/i }) as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
  });

  it("shows a generic, non-technical message when resend fails", async () => {
    resendMock.mockResolvedValue({ ok: false, error: "resend_failed" });
    const user = userEvent.setup();
    render(<VerificationPending variant="unverified" />);

    await user.click(screen.getByRole("button", { name: "Send bekreftelseslenke på nytt" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/kunne ikke sende lenken/i);
    expect(alert.textContent).not.toMatch(/auth\//);
  });
});

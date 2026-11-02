// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { erasureCopy } from "../copy";
import type { ErasureClientGateway } from "../client/run-erasure-flow";
import { ErasureConfirmation } from "./ErasureConfirmation";

// TASK-039: the confirmation screen with an injected gateway. No Firebase, no network.

const EMAIL = "erased@example.com";
const PASSWORD = "synthetic-password";

function gatewayWith(overrides: Partial<ErasureClientGateway> = {}) {
  const order: string[] = [];
  const gateway: ErasureClientGateway = {
    signedInEmail: () => EMAIL,
    reauthenticate: vi.fn(async () => {
      order.push("reauth");
    }),
    idToken: async () => "id-token",
    startOrResume: vi.fn(async () => {
      order.push("post");
      return { status: 200, body: { status: "completed" } };
    }),
    signOut: vi.fn(async () => undefined),
    wait: async () => undefined,
    ...overrides,
  };
  return { gateway, order };
}

afterEach(() => {
  cleanup();
});

describe("ErasureConfirmation", () => {
  it("states every consequence, and requires the typed e-mail and the password", () => {
    const { gateway } = gatewayWith();
    render(<ErasureConfirmation gateway={gateway} />);

    for (const consequence of erasureCopy.consequences) {
      expect(screen.getByText(consequence)).toBeTruthy();
    }
    expect(screen.getByLabelText(erasureCopy.emailLabel).hasAttribute("required")).toBe(true);
    expect(screen.getByLabelText(erasureCopy.passwordLabel).hasAttribute("required")).toBe(true);
  });

  it("refuses an empty submission with the required copy, and does not sign in or call the endpoint", async () => {
    const { gateway } = gatewayWith();
    render(<ErasureConfirmation gateway={gateway} />);

    await userEvent.click(screen.getByRole("button", { name: erasureCopy.submit }));

    expect(await screen.findByText(erasureCopy.errors.required)).toBeTruthy();
    expect(gateway.reauthenticate).not.toHaveBeenCalled();
    expect(gateway.startOrResume).not.toHaveBeenCalled();
  });

  it("signs in again before the request, then shows the neutral completed screen with no recovery control", async () => {
    const { gateway, order } = gatewayWith();
    render(<ErasureConfirmation gateway={gateway} />);

    await userEvent.type(screen.getByLabelText(erasureCopy.emailLabel), EMAIL);
    await userEvent.type(screen.getByLabelText(erasureCopy.passwordLabel), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: erasureCopy.submit }));

    expect(await screen.findByRole("heading", { name: erasureCopy.completedTitle })).toBeTruthy();
    expect(order).toEqual(["reauth", "post"]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/angre|gjenopprett/i)).toBeNull();
  });

  it("shows only the fixed copy when re-authentication fails, and does not call the endpoint", async () => {
    const { gateway } = gatewayWith({
      reauthenticate: vi.fn(async () => {
        throw new Error("auth/invalid-credential for someone@example.com");
      }),
    });
    render(<ErasureConfirmation gateway={gateway} />);

    await userEvent.type(screen.getByLabelText(erasureCopy.emailLabel), EMAIL);
    await userEvent.type(screen.getByLabelText(erasureCopy.passwordLabel), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: erasureCopy.submit }));

    const alert = await screen.findByText(erasureCopy.errors.reauthFailed);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(document.body.textContent).not.toContain("someone@example.com");
    expect(document.body.textContent).not.toContain("auth/invalid-credential");
    expect(gateway.startOrResume).not.toHaveBeenCalled();
  });

  it("clears the password from the form after the attempt", async () => {
    const { gateway } = gatewayWith({
      reauthenticate: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    render(<ErasureConfirmation gateway={gateway} />);

    const password = screen.getByLabelText(erasureCopy.passwordLabel) as HTMLInputElement;
    await userEvent.type(screen.getByLabelText(erasureCopy.emailLabel), EMAIL);
    await userEvent.type(password, PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: erasureCopy.submit }));

    await screen.findByText(erasureCopy.errors.reauthFailed);
    expect(password.value).toBe("");
  });

  it("keeps the progress loop going on in_progress and announces progress in a live region", async () => {
    const responses = [
      { status: 200, body: { status: "in_progress", step: "forum" } },
      { status: 200, body: { status: "completed" } },
    ];
    const { gateway } = gatewayWith({
      startOrResume: vi.fn(async () => responses.shift() as { status: number; body: unknown }),
    });
    render(<ErasureConfirmation gateway={gateway} />);

    await userEvent.type(screen.getByLabelText(erasureCopy.emailLabel), EMAIL);
    await userEvent.type(screen.getByLabelText(erasureCopy.passwordLabel), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: erasureCopy.submit }));

    await waitFor(() => expect(screen.getByRole("heading", { name: erasureCopy.completedTitle })).toBeTruthy());
    expect(gateway.startOrResume).toHaveBeenCalledTimes(2);
  });

  it("offers a cancel link back to the profile page, next to the destructive submit", () => {
    const { gateway } = gatewayWith();
    render(<ErasureConfirmation gateway={gateway} />);

    const cancel = screen.getByRole("link", { name: erasureCopy.cancel });
    expect(cancel.getAttribute("href")).toBe("/me/profile");
  });

  it("moves focus to the e-mail field after a failed attempt", async () => {
    const { gateway } = gatewayWith({
      reauthenticate: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    render(<ErasureConfirmation gateway={gateway} />);

    await userEvent.type(screen.getByLabelText(erasureCopy.emailLabel), EMAIL);
    await userEvent.type(screen.getByLabelText(erasureCopy.passwordLabel), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: erasureCopy.submit }));

    await screen.findByText(erasureCopy.errors.reauthFailed);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(erasureCopy.emailLabel)));
  });

  it("announces the progress of a running erasure in a status live region", async () => {
    const { gateway } = gatewayWith({
      startOrResume: vi.fn(() => new Promise<never>(() => undefined)),
    });
    render(<ErasureConfirmation gateway={gateway} />);

    await userEvent.type(screen.getByLabelText(erasureCopy.emailLabel), EMAIL);
    await userEvent.type(screen.getByLabelText(erasureCopy.passwordLabel), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: erasureCopy.submit }));

    const progress = await screen.findByText(erasureCopy.progress);
    expect(progress.closest('[role="status"]')).not.toBeNull();
  });
});

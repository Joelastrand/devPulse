// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signOutMock = vi.fn();
vi.mock("../../auth/client/auth-client", () => ({
  signOut: () => signOutMock(),
}));

const { ProfileSignOutButton } = await import("./ProfileSignOutButton");
const { profileCopy } = await import("../copy");

describe("ProfileSignOutButton", () => {
  beforeEach(() => {
    signOutMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a real button labelled 'Logg ut' with the icon before the text", () => {
    const { container } = render(<ProfileSignOutButton />);

    const button = screen.getByRole("button", { name: profileCopy.signOutButton });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("inline-flex");
    expect(button.className).toContain("items-center");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("invokes the existing client sign-out when activated", async () => {
    const user = userEvent.setup();
    signOutMock.mockResolvedValue({ ok: true });
    render(<ProfileSignOutButton />);

    await user.click(screen.getByRole("button", { name: profileCopy.signOutButton }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: profileCopy.signOutButton })).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a generic error when sign-out fails", async () => {
    const user = userEvent.setup();
    signOutMock.mockResolvedValue({ ok: false, error: "sign_out_failed" });
    render(<ProfileSignOutButton />);

    await user.click(screen.getByRole("button", { name: profileCopy.signOutButton }));

    expect((await screen.findByRole("alert")).textContent).toBe(profileCopy.genericError);
  });
});

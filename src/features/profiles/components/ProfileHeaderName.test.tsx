// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { profileCopy } from "../copy";

const observeIdTokenMock = vi.fn();
const fetchOwnProfileMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../client/profile-gateway", () => ({ fetchOwnProfile: fetchOwnProfileMock }));

const { ProfileHeaderName } = await import("./ProfileHeaderName");

function signedInWith(token: string | null) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  });
}

afterEach(() => {
  cleanup();
  observeIdTokenMock.mockReset();
  fetchOwnProfileMock.mockReset();
});

describe("ProfileHeaderName (visual-redesign TASK-016, decision A)", () => {
  it("shows the viewer's own display name from the existing profile read", async () => {
    signedInWith("a-token");
    fetchOwnProfileMock.mockResolvedValue({ status: "ok", displayName: "Kari Nordmann" });

    render(<ProfileHeaderName />);

    expect(await screen.findByText("Kari Nordmann")).toBeTruthy();
    expect(fetchOwnProfileMock).toHaveBeenCalledWith("a-token");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("shows the existing no-name copy when the viewer has no display name", async () => {
    signedInWith("a-token");
    fetchOwnProfileMock.mockResolvedValue({ status: "ok", displayName: null });

    render(<ProfileHeaderName />);

    expect(await screen.findByText(profileCopy.noName)).toBeTruthy();
  });

  it("shows nothing and makes no request when signed out", async () => {
    signedInWith(null);

    const { container } = render(<ProfileHeaderName />);

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(fetchOwnProfileMock).not.toHaveBeenCalled();
  });

  it("shows nothing on a read failure, never another person's name or a fabricated value", async () => {
    signedInWith("a-token");
    fetchOwnProfileMock.mockResolvedValue({ status: "read_failed" });

    const { container } = render(<ProfileHeaderName />);

    await waitFor(() => expect(fetchOwnProfileMock).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchAuthUsersMock = vi.fn();
const fetchAuthUserDetailMock = vi.fn();
const setAuthUserDisabledMock = vi.fn();

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const React = await import("react");
  return {
    // Signed in with a fixed token after mount, as the real hook reports it.
    useAuthGatedResource: (callback: (token: string) => void) => {
      React.useEffect(() => {
        callback("token-admin");
      }, []);
    },
  };
});
vi.mock("../client/user-management-gateway", () => ({
  fetchAuthUsers: fetchAuthUsersMock,
  fetchAuthUserDetail: fetchAuthUserDetailMock,
  setAuthUserDisabled: setAuthUserDisabledMock,
}));

const { AdminUsers } = await import("./AdminUsers");

const ORDINARY = {
  uid: "u-1",
  email: "employee@nve.no",
  emailVerified: true,
  disabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSignInAt: null,
};

describe("AdminUsers", () => {
  afterEach(() => {
    cleanup();
    fetchAuthUsersMock.mockReset();
    fetchAuthUserDetailMock.mockReset();
    setAuthUserDisabledMock.mockReset();
  });

  it("shows verification and enabled status as text for each listed account", async () => {
    fetchAuthUsersMock.mockResolvedValue({ ok: true, users: [ORDINARY], nextPageToken: null });
    render(<AdminUsers />);

    expect((await screen.findAllByText("employee@nve.no")).length).toBeGreaterThan(0);
    expect(screen.getByText(/E-post bekreftet · Aktiv/)).toBeTruthy();
  });

  it("does not call the server on the first disable click; only the explicit confirmation sends it", async () => {
    fetchAuthUsersMock.mockResolvedValue({ ok: true, users: [ORDINARY], nextPageToken: null });
    fetchAuthUserDetailMock.mockResolvedValue({ ok: true, user: ORDINARY, teams: [] });
    setAuthUserDisabledMock.mockResolvedValue({ ok: true, uid: "u-1", disabled: true });
    const user = userEvent.setup();
    render(<AdminUsers />);

    await user.click(await screen.findByRole("button", { name: /Vis/ }));
    await user.click(await screen.findByRole("button", { name: "Deaktiver konto" }));

    expect(setAuthUserDisabledMock).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Deaktivere kontoen?" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Bekreft deaktivering" }));
    await waitFor(() => expect(setAuthUserDisabledMock).toHaveBeenCalledWith("token-admin", "u-1", true));
  });

  it("shows a fixed Norwegian message when the list fails, not the raw error code", async () => {
    fetchAuthUsersMock.mockResolvedValue({ ok: false, error: "forbidden" });
    render(<AdminUsers />);

    expect(await screen.findByText("Du har ikke tilgang til brukeradministrasjon.")).toBeTruthy();
    expect(screen.queryByText("forbidden")).toBeNull();
  });
});

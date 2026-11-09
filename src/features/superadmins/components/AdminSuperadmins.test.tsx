// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
const fetchSuperadminsMock = vi.fn();
const grantSuperadminMock = vi.fn();
const revokeSuperadminMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/superadmins-gateway", () => ({
  fetchSuperadmins: fetchSuperadminsMock,
  grantSuperadmin: grantSuperadminMock,
  revokeSuperadmin: revokeSuperadminMock,
}));

const { AdminSuperadmins } = await import("./AdminSuperadmins");

const LIST = {
  ok: true,
  superadmins: [
    { uid: "admin-uid", grantedAt: "2026-10-01T10:00:00.000Z" },
    { uid: "second-uid", grantedAt: null },
  ],
};

function signedIn(token = "a-token") {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminSuperadmins", () => {
  it("shows the active superadmins by UID once loaded", async () => {
    signedIn();
    fetchSuperadminsMock.mockResolvedValue(LIST);

    render(<AdminSuperadmins />);

    expect(await screen.findByText("admin-uid")).toBeTruthy();
    expect(screen.getByText("second-uid")).toBeTruthy();
  });

  it("asks for confirmation before revoking and does not call the server until it is confirmed", async () => {
    signedIn();
    fetchSuperadminsMock.mockResolvedValue(LIST);
    revokeSuperadminMock.mockResolvedValue({ ok: true, outcome: "revoked", uid: "second-uid" });
    const user = userEvent.setup();

    render(<AdminSuperadmins />);
    const removeButtons = await screen.findAllByRole("button", { name: "Fjern tilgang" });
    await user.click(removeButtons[1]);

    expect(screen.getByText("Fjerne superadministrator?")).toBeTruthy();
    expect(revokeSuperadminMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(revokeSuperadminMock).not.toHaveBeenCalled();
  });

  it("revokes only after the confirmation and reports success", async () => {
    signedIn();
    fetchSuperadminsMock.mockResolvedValueOnce(LIST).mockResolvedValueOnce({ ok: true, superadmins: [LIST.superadmins[0]] });
    revokeSuperadminMock.mockResolvedValue({ ok: true, outcome: "revoked", uid: "second-uid" });
    const user = userEvent.setup();

    render(<AdminSuperadmins />);
    const removeButtons = await screen.findAllByRole("button", { name: "Fjern tilgang" });
    await user.click(removeButtons[1]);
    await user.click(screen.getByRole("button", { name: "Ja, fjern tilgang" }));

    await waitFor(() => expect(revokeSuperadminMock).toHaveBeenCalledWith("a-token", "second-uid"));
    expect(await screen.findByText("Superadministratoren er fjernet.")).toBeTruthy();
  });

  it("shows the Norwegian copy for last_superadmin and keeps the list", async () => {
    signedIn();
    fetchSuperadminsMock.mockResolvedValue(LIST);
    revokeSuperadminMock.mockResolvedValue({ ok: false, error: "last_superadmin" });
    const user = userEvent.setup();

    render(<AdminSuperadmins />);
    const removeButtons = await screen.findAllByRole("button", { name: "Fjern tilgang" });
    await user.click(removeButtons[0]);
    await user.click(screen.getByRole("button", { name: "Ja, fjern tilgang" }));

    expect(await screen.findByText(/Den siste aktive superadministratoren kan ikke fjernes/)).toBeTruthy();
    expect(screen.getByText("admin-uid")).toBeTruthy();
  });

  it("sends the typed e-mail as the grant target and reports an unknown account without a raw code", async () => {
    signedIn();
    fetchSuperadminsMock.mockResolvedValue(LIST);
    grantSuperadminMock.mockResolvedValue({ ok: false, error: "target_not_found" });
    const user = userEvent.setup();

    render(<AdminSuperadmins />);
    await screen.findByText("admin-uid");
    await user.type(screen.getByLabelText("E-postadresse"), "new@example.test");
    await user.click(screen.getByRole("button", { name: "Legg til" }));

    expect(grantSuperadminMock).toHaveBeenCalledWith("a-token", "new@example.test");
    expect(await screen.findByText(/Fant ingen konto med denne e-postadressen/)).toBeTruthy();
    expect(screen.queryByText("target_not_found")).toBeNull();
  });
});

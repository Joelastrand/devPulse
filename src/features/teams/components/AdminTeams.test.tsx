// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
const fetchAdminTeamsMock = vi.fn();
const createAdminTeamMock = vi.fn();
const setAdminTeamStatusMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/admin-teams-gateway", () => ({
  fetchAdminTeams: fetchAdminTeamsMock,
  createAdminTeam: createAdminTeamMock,
  setAdminTeamStatus: setAdminTeamStatusMock,
}));

const { AdminTeams } = await import("./AdminTeams");

/** Simulates the auth subscription immediately emitting one token value. */
function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

/**
 * Captures the `observeIdToken` callback so a test can fire multiple auth
 * events (sign-out, account switch) at will.
 */
function capturingObserver() {
  let callback: ((token: string | null) => void) | null = null;
  observeIdTokenMock.mockImplementation((cb: (token: string | null) => void) => {
    callback = cb;
    return () => {};
  });
  return {
    emit(token: string | null) {
      callback?.(token);
    },
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminTeams", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchAdminTeamsMock.mockReset();
    createAdminTeamMock.mockReset();
    setAdminTeamStatusMock.mockReset();
  });

  it("shows a Norwegian loading state before auth resolves", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<AdminTeams />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("prompts sign-in when the visitor is signed out, and never fetches", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<AdminTeams />);

    await screen.findByRole("link", { name: /logg inn/i });
    expect(fetchAdminTeamsMock).not.toHaveBeenCalled();
  });

  it("prompts sign-in when the server reports the list call as unauthenticated", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "unauthenticated" });

    render(<AdminTeams />);

    await screen.findByRole("link", { name: /logg inn/i });
  });

  it("shows a generic Norwegian forbidden message for an authenticated non-admin, never revealing allow-list membership", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "forbidden" });

    render(<AdminTeams />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ikke tilgang/i);
    expect(alert.textContent).not.toMatch(/admin_emails|allow-?list|@/i);
  });

  it("shows a generic error state on a read failure, never a fabricated list", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "read_failed" });

    render(<AdminTeams />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
  });

  it("shows a zero-teams state for an admin with no teams yet, while still offering a way to create one", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "ok", teams: [] });

    render(<AdminTeams />);

    const status = await screen.findByText(/ingen team/i);
    expect(status).toBeTruthy();
    expect(screen.getByRole("button", { name: /nytt team/i })).toBeTruthy();
  });

  it("shows both active and disabled teams for an admin", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-1", name: "Platform", status: "active" },
        { teamId: "team-2", name: "Legacy", status: "disabled" },
      ],
    });

    render(<AdminTeams />);

    await screen.findByText("Platform");
    expect(screen.getByText("Legacy")).toBeTruthy();
    expect(screen.getByText("Aktivt")).toBeTruthy();
    expect(screen.getByText("Deaktivert")).toBeTruthy();
    expect(screen.getByRole("button", { name: /deaktiver team/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^aktiver team/i })).toBeTruthy();
  });

  it("renders team status via the Badge primitive, and the admin summary count from already-loaded data", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-1", name: "Platform", status: "active" },
        { teamId: "team-2", name: "Legacy", status: "disabled" },
        { teamId: "team-3", name: "Mobile", status: "active" },
      ],
    });

    render(<AdminTeams />);

    await screen.findByText("Platform");
    const activeBadge = screen.getAllByText("Aktivt")[0];
    expect(activeBadge.tagName).toBe("SPAN");
    expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2 aktive · 1 deaktiverte")).toBeTruthy();
  });

  it("labels each team's opaque Firestore ID clearly instead of showing it bare", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
    });

    render(<AdminTeams />);

    await screen.findByText("Platform");
    expect(screen.getByText("Aktivt")).toBeTruthy();
    expect(screen.getByText(/Team-ID: team-1/)).toBeTruthy();
  });

  it("never renders survey/aggregate data, member/invitation identities, or internal Firebase metadata", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
    });

    const { container } = render(<AdminTeams />);
    await screen.findByText("Platform");

    expect(container.textContent).not.toMatch(/@|invited|ciphertext|mean|responses|createdBy/i);
  });

  it("creates a team using the server-generated teamId, never a client-fabricated one, and refreshes the authoritative list", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock
      .mockResolvedValueOnce({ status: "ok", teams: [] })
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "server-generated-id", name: "Mobile", status: "active" }],
      });
    createAdminTeamMock.mockResolvedValue({ ok: true, teamId: "server-generated-id" });

    render(<AdminTeams />);
    await screen.findByText(/ingen team/i);

    await user.click(screen.getByRole("button", { name: /nytt team/i }));
    await user.type(screen.getByLabelText(/nytt teamnavn/i), "Mobile");
    await user.click(screen.getByRole("button", { name: /opprett team/i }));

    expect(createAdminTeamMock).toHaveBeenCalledWith("a-token", "Mobile");
    await screen.findByText("Mobile");
    expect(screen.getByText(/server-generated-id/)).toBeTruthy();
    expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(2);
    // Successful creation collapses the form again (BR-14).
    expect(screen.queryByLabelText(/nytt teamnavn/i)).toBeNull();
  });

  it("shows a controlled Norwegian error and does not fabricate a team when create fails", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "ok", teams: [] });
    createAdminTeamMock.mockResolvedValue({ ok: false, error: "invalid_name" });

    render(<AdminTeams />);
    await screen.findByText(/ingen team/i);

    await user.click(screen.getByRole("button", { name: /nytt team/i }));
    await user.click(screen.getByRole("button", { name: /opprett team/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/skriv inn et teamnavn/i);
    expect(screen.getByText(/ingen team/i)).toBeTruthy();
    // Failed creation leaves the form available so the user can recover (BR-14).
    expect(screen.getByLabelText(/nytt teamnavn/i)).toBeTruthy();
  });

  it("does not fire a second create request from repeated clicks while one is already in flight", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "ok", teams: [] });
    let resolveCreate: (value: unknown) => void = () => {};
    createAdminTeamMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    render(<AdminTeams />);
    await screen.findByText(/ingen team/i);

    await user.click(screen.getByRole("button", { name: /nytt team/i }));
    const button = screen.getByRole("button", { name: /opprett team/i });
    await user.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);

    // The disabled button rejects further real clicks (userEvent respects
    // the `disabled` attribute), proving the in-flight guard holds.
    await user.click(button);
    await user.click(button);

    expect(createAdminTeamMock).toHaveBeenCalledTimes(1);

    resolveCreate({ ok: true, teamId: "team-x" });
    await flushMicrotasks();
  });

  it("keeps the creation form collapsed by default, with the toggle exposing aria-expanded", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
    });

    render(<AdminTeams />);
    await screen.findByText("Platform");

    expect(screen.queryByLabelText(/nytt teamnavn/i)).toBeNull();
    const toggle = screen.getByRole("button", { name: /nytt team/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const user = userEvent.setup();
    await user.click(toggle);

    expect(screen.getByLabelText(/nytt teamnavn/i)).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Opening the form triggers no fetch of any kind (BR-14).
    expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(1);
  });

  it("closes the creation form via Cancel without creating anything or fetching again", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({ status: "ok", teams: [] });

    render(<AdminTeams />);
    await screen.findByText(/ingen team/i);

    await user.click(screen.getByRole("button", { name: /nytt team/i }));
    await user.type(screen.getByLabelText(/nytt teamnavn/i), "Mobile");
    await user.click(screen.getByRole("button", { name: /avbryt/i }));

    expect(screen.queryByLabelText(/nytt teamnavn/i)).toBeNull();
    expect(screen.getByRole("button", { name: /nytt team/i }).getAttribute("aria-expanded")).toBe("false");
    expect(createAdminTeamMock).not.toHaveBeenCalled();
    expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(1);
  });

  it("disables an active team and refreshes the authoritative list", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
      })
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Platform", status: "disabled" }],
      });
    setAdminTeamStatusMock.mockResolvedValue({ ok: true });

    render(<AdminTeams />);
    await screen.findByText("Platform");

    await user.click(screen.getByRole("button", { name: /deaktiver team/i }));

    expect(setAdminTeamStatusMock).toHaveBeenCalledWith("a-token", "team-1", "disabled");
    await screen.findByRole("button", { name: /^aktiver team/i });
    expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(2);
  });

  it("re-enables a disabled team and refreshes the authoritative list", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Legacy", status: "disabled" }],
      })
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Legacy", status: "active" }],
      });
    setAdminTeamStatusMock.mockResolvedValue({ ok: true });

    render(<AdminTeams />);
    await screen.findByText("Legacy");

    await user.click(screen.getByRole("button", { name: /^aktiver team/i }));

    expect(setAdminTeamStatusMock).toHaveBeenCalledWith("a-token", "team-1", "active");
    await screen.findByRole("button", { name: /deaktiver team/i });
    expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(2);
  });

  it("shows a controlled Norwegian error and does not silently flip the row when a status update fails", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
    });
    setAdminTeamStatusMock.mockResolvedValue({ ok: false, error: "forbidden" });

    render(<AdminTeams />);
    await screen.findByText("Platform");

    await user.click(screen.getByRole("button", { name: /deaktiver team/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    // Still shows the original state and action, not a fabricated flip.
    expect(screen.getByRole("button", { name: /deaktiver team/i })).toBeTruthy();
    expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(1);
  });

  it("does not fire a second disable request from repeated clicks while one is already in flight", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
    });
    let resolveStatus: (value: unknown) => void = () => {};
    setAdminTeamStatusMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );

    render(<AdminTeams />);
    await screen.findByText("Platform");

    const button = screen.getByRole("button", { name: /deaktiver team/i });
    await user.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);

    // The disabled button rejects further real clicks; the handler's own
    // per-team guard is what's actually proven here.
    await user.click(button);
    await user.click(button);

    expect(setAdminTeamStatusMock).toHaveBeenCalledTimes(1);

    resolveStatus({ ok: true });
    await flushMicrotasks();
  });

  it("does not fire a second enable request from repeated clicks while one is already in flight", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Legacy", status: "disabled" }],
    });
    let resolveStatus: (value: unknown) => void = () => {};
    setAdminTeamStatusMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );

    render(<AdminTeams />);
    await screen.findByText("Legacy");

    const button = screen.getByRole("button", { name: /^aktiver team/i });
    await user.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);

    await user.click(button);
    await user.click(button);

    expect(setAdminTeamStatusMock).toHaveBeenCalledTimes(1);

    resolveStatus({ ok: true });
    await flushMicrotasks();
  });

  it("allows a different team's status action to proceed independently while another team's action is pending", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [
        { teamId: "team-1", name: "Platform", status: "active" },
        { teamId: "team-2", name: "Mobile", status: "active" },
      ],
    });
    let resolveTeam1: (value: unknown) => void = () => {};
    setAdminTeamStatusMock.mockImplementation((_token: string, teamId: string) => {
      if (teamId === "team-1") {
        return new Promise((resolve) => {
          resolveTeam1 = resolve;
        });
      }
      return Promise.resolve({ ok: true });
    });

    render(<AdminTeams />);
    await screen.findByText("Platform");

    const [team1Button, team2Button] = screen.getAllByRole("button", { name: /deaktiver team/i });
    await user.click(team1Button);
    expect(team1Button.hasAttribute("disabled")).toBe(true);

    // team-2's action is untouched by team-1's still-pending mutation.
    expect(team2Button.hasAttribute("disabled")).toBe(false);
    await user.click(team2Button);

    expect(setAdminTeamStatusMock).toHaveBeenCalledWith("a-token", "team-1", "disabled");
    expect(setAdminTeamStatusMock).toHaveBeenCalledWith("a-token", "team-2", "disabled");
    expect(setAdminTeamStatusMock).toHaveBeenCalledTimes(2);

    resolveTeam1({ ok: true });
    await flushMicrotasks();
  });

  it("unsubscribes from id token updates on unmount", () => {
    const unsubscribe = vi.fn();
    observeIdTokenMock.mockImplementation(() => unsubscribe);

    const { unmount } = render(<AdminTeams />);
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("contains no leftover English copy", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminTeamsMock.mockResolvedValue({
      status: "ok",
      teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
    });

    render(<AdminTeams />);
    await screen.findByText("Platform");

    expect(screen.queryByText(/^sign in$/i)).toBeNull();
    expect(screen.queryByText(/^create team$/i)).toBeNull();
    expect(screen.queryByText(/^disable team$/i)).toBeNull();
    expect(screen.queryByText(/^loading teams/i)).toBeNull();
    expect(screen.queryByText(/^active$/i)).toBeNull();
  });
});

describe("AdminTeams auth races", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchAdminTeamsMock.mockReset();
    createAdminTeamMock.mockReset();
    setAdminTeamStatusMock.mockReset();
  });

  it("ignores a stale create result if the user signs out before it resolves", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    fetchAdminTeamsMock.mockResolvedValue({ status: "ok", teams: [] });
    let resolveCreate: (value: unknown) => void = () => {};
    createAdminTeamMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    render(<AdminTeams />);
    observer.emit("token-a");
    await screen.findByText(/ingen team/i);

    await user.click(screen.getByRole("button", { name: /nytt team/i }));
    await user.type(screen.getByLabelText(/nytt teamnavn/i), "Mobile");
    await user.click(screen.getByRole("button", { name: /opprett team/i }));

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    resolveCreate({ ok: true, teamId: "team-x" });
    await flushMicrotasks();

    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
    expect(screen.queryByText("Mobile")).toBeNull();
  });

  it("ignores a stale create result if the account switches before it resolves", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    fetchAdminTeamsMock
      .mockResolvedValueOnce({ status: "ok", teams: [] })
      .mockResolvedValueOnce({ status: "ok", teams: [] });
    let resolveCreate: (value: unknown) => void = () => {};
    createAdminTeamMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    render(<AdminTeams />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /nytt team/i }));
    await user.type(screen.getByLabelText(/nytt teamnavn/i), "Mobile");
    await user.click(screen.getByRole("button", { name: /opprett team/i }));

    observer.emit("token-b");
    await waitFor(() => expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(2));

    resolveCreate({ ok: true, teamId: "team-x" });
    await flushMicrotasks();

    // Account B's own (empty) list load must not be clobbered by account
    // A's stale, now-superseded create result.
    expect(screen.getByRole("status").textContent).toMatch(/ingen team/i);
    expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale status-update result if the account switches before it resolves", async () => {
    const observer = capturingObserver();
    const user = userEvent.setup();
    fetchAdminTeamsMock
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
      })
      .mockResolvedValueOnce({
        status: "ok",
        teams: [{ teamId: "team-2", name: "Mobile", status: "active" }],
      });
    let resolveStatus: (value: unknown) => void = () => {};
    setAdminTeamStatusMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );

    render(<AdminTeams />);
    observer.emit("token-a");
    await screen.findByText("Platform");

    await user.click(screen.getByRole("button", { name: /deaktiver team/i }));

    observer.emit("token-b");
    await screen.findByText("Mobile");

    resolveStatus({ ok: true });
    await flushMicrotasks();

    // Account B's own list must be the only thing rendered — account A's
    // stale status-update refresh must never run against B's view.
    expect(screen.queryByText("Platform")).toBeNull();
    expect(screen.getByText("Mobile")).toBeTruthy();
    expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(2);
  });

  it("does not update state after unmount even if a pending list fetch resolves later", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const observer = capturingObserver();
    let resolveList: (value: unknown) => void = () => {};
    fetchAdminTeamsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    const { unmount } = render(<AdminTeams />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchAdminTeamsMock).toHaveBeenCalledTimes(1));

    unmount();

    expect(() =>
      resolveList({
        status: "ok",
        teams: [{ teamId: "team-1", name: "Platform", status: "active" }],
      }),
    ).not.toThrow();
    await flushMicrotasks();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

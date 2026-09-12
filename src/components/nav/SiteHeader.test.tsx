// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
const signOutMock = vi.fn();
const fetchOwnAdminStatusMock = vi.fn();
const usePathnameMock = vi.fn(() => "/");

vi.mock("../../features/auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
  signOut: signOutMock,
}));

vi.mock("../../features/teams/client/own-admin-status-gateway", () => ({
  fetchOwnAdminStatus: fetchOwnAdminStatusMock,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

const { SiteHeader } = await import("./SiteHeader");

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

/** Captures the `observeIdToken` callback so a test can fire later auth events at will. */
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

const SIGNED_OUT_LINK_NAMES = [/hjem/i, /pulsundersøkelse/i, /logg inn/i, /opprett konto/i];
const SIGNED_IN_LINK_NAMES = [/hjem/i, /pulsundersøkelse/i, /^team$/i];

function navLinkNames() {
  const nav = screen.getByRole("navigation");
  return Array.from(nav.querySelectorAll("a")).map((link) => link.textContent);
}

describe("SiteHeader", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    signOutMock.mockReset();
    fetchOwnAdminStatusMock.mockReset();
    usePathnameMock.mockReset();
    usePathnameMock.mockReturnValue("/");
  });

  it("shows exactly the signed-out link set before any auth event, and never checks admin status", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<SiteHeader />);

    for (const name of SIGNED_OUT_LINK_NAMES) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    expect(navLinkNames()).toHaveLength(SIGNED_OUT_LINK_NAMES.length);
    expect(fetchOwnAdminStatusMock).not.toHaveBeenCalled();
  });

  it("shows exactly the signed-out link set when the visitor is signed out", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<SiteHeader />);

    for (const name of SIGNED_OUT_LINK_NAMES) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    expect(navLinkNames()).toHaveLength(SIGNED_OUT_LINK_NAMES.length);
    expect(screen.queryByRole("button", { name: /logg ut/i })).toBeNull();
  });

  it("shows exactly the signed-in, non-admin link set plus a Logg ut action for a non-admin caller", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: false });

    render(<SiteHeader />);

    await waitFor(() => expect(fetchOwnAdminStatusMock).toHaveBeenCalledWith("a-token"));
    for (const name of SIGNED_IN_LINK_NAMES) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    expect(navLinkNames()).toHaveLength(SIGNED_IN_LINK_NAMES.length);
    expect(screen.getByRole("button", { name: /logg ut/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^admin$/i })).toBeNull();
  });

  it("adds the Admin link only once the own-admin-status read confirms it", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: true });

    render(<SiteHeader />);

    const adminLink = await screen.findByRole("link", { name: /^admin$/i });
    expect(adminLink.getAttribute("href")).toBe("/admin/teams");
    expect(navLinkNames()).toHaveLength(SIGNED_IN_LINK_NAMES.length + 1);
  });

  it("never shows Admin when the own-admin-status read fails (fails closed, not open)", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnAdminStatusMock.mockResolvedValue({ ok: false, error: "read_failed" });

    render(<SiteHeader />);

    await waitFor(() => expect(fetchOwnAdminStatusMock).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /^admin$/i })).toBeNull();
  });

  it("never shows Admin while the own-admin-status read is still in flight", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnAdminStatusMock.mockImplementation(() => new Promise(() => {}));

    render(<SiteHeader />);

    await screen.findByRole("button", { name: /logg ut/i });
    expect(screen.queryByRole("link", { name: /^admin$/i })).toBeNull();
  });

  it("has no client-side admin allow-list check — Admin visibility comes solely from the /api/me gateway result", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: true });

    render(<SiteHeader />);

    await screen.findByRole("link", { name: /^admin$/i });
    // The only way this component can ever know admin status is through
    // the mocked gateway call below — there is no other admin/allow-list
    // source it could have consulted.
    expect(fetchOwnAdminStatusMock).toHaveBeenCalledTimes(1);
    expect(fetchOwnAdminStatusMock).toHaveBeenCalledWith("a-token");
  });

  it("signs out via the Firebase client SDK when Logg ut is activated, and returns to the signed-out set without a reload", async () => {
    const user = userEvent.setup();
    const observer = capturingObserver();
    signOutMock.mockImplementation(async () => {
      observer.emit(null);
      return { ok: true };
    });
    fetchOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: false });

    render(<SiteHeader />);
    observer.emit("a-token");
    await waitFor(() => expect(fetchOwnAdminStatusMock).toHaveBeenCalled());

    const signOutButton = await screen.findByRole("button", { name: /logg ut/i });
    await user.click(signOutButton);

    expect(signOutMock).toHaveBeenCalled();
    await waitFor(() => {
      for (const name of SIGNED_OUT_LINK_NAMES) {
        expect(screen.getByRole("link", { name })).toBeTruthy();
      }
    });
    expect(screen.queryByRole("button", { name: /logg ut/i })).toBeNull();
  });

  it("marks the current page's nav link with aria-current", () => {
    usePathnameMock.mockReturnValue("/pulse-survey");
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: /pulsundersøkelse/i }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: /hjem/i }).getAttribute("aria-current")).toBeNull();
  });

  it("uses next/link for every navigational link, never a plain <a> with a synthetic click handler removed", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<SiteHeader />);

    for (const link of screen.getAllByRole("link")) {
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("href")).toBeTruthy();
    }
  });

  it("unsubscribes from id token updates on unmount", () => {
    const unsubscribe = vi.fn();
    observeIdTokenMock.mockImplementation(() => unsubscribe);

    const { unmount } = render(<SiteHeader />);
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe("SiteHeader auth-state races", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    signOutMock.mockReset();
    fetchOwnAdminStatusMock.mockReset();
  });

  it("ignores a stale admin-status result that resolves after the caller has signed out", async () => {
    const observer = capturingObserver();
    let resolveStatus: ((value: unknown) => void) | undefined;
    fetchOwnAdminStatusMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );

    render(<SiteHeader />);
    observer.emit("a-token");
    await waitFor(() => expect(fetchOwnAdminStatusMock).toHaveBeenCalled());

    observer.emit(null);
    await screen.findByRole("link", { name: /logg inn/i });

    resolveStatus?.({ ok: true, isAdmin: true });
    await flushMicrotasks();

    expect(screen.queryByRole("link", { name: /^admin$/i })).toBeNull();
    expect(screen.getByRole("link", { name: /logg inn/i })).toBeTruthy();
  });

  it("shows only the newer account's admin status when an account switch resolves out of order", async () => {
    const observer = capturingObserver();
    const resolvers: Array<(value: unknown) => void> = [];
    fetchOwnAdminStatusMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    render(<SiteHeader />);
    observer.emit("token-a");
    await waitFor(() => expect(fetchOwnAdminStatusMock).toHaveBeenCalledTimes(1));

    observer.emit("token-b");
    await waitFor(() => expect(fetchOwnAdminStatusMock).toHaveBeenCalledTimes(2));

    // Account B (non-admin) resolves first, then stale account A's
    // "isAdmin: true" arrives late — it must never retroactively grant
    // Admin to the now-current, non-admin account B.
    resolvers[1]({ ok: true, isAdmin: false });
    await waitFor(() => expect(screen.queryByRole("link", { name: /^admin$/i })).toBeNull());

    resolvers[0]({ ok: true, isAdmin: true });
    await flushMicrotasks();

    expect(screen.queryByRole("link", { name: /^admin$/i })).toBeNull();
  });

  it("does not update state after unmount even if a pending admin-status fetch resolves later", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const observer = capturingObserver();
    let resolveStatus: ((value: unknown) => void) | undefined;
    fetchOwnAdminStatusMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );

    const { unmount } = render(<SiteHeader />);
    observer.emit("a-token");
    await waitFor(() => expect(fetchOwnAdminStatusMock).toHaveBeenCalled());

    unmount();

    expect(() => resolveStatus?.({ ok: true, isAdmin: true })).not.toThrow();
    await flushMicrotasks();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
const signOutMock = vi.fn();
const fetchOwnAdminStatusMock = vi.fn();
let mockPathname = "/";

vi.mock("../../features/auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
  signOut: signOutMock,
}));

vi.mock("../../features/teams/client/own-admin-status-gateway", () => ({
  fetchOwnAdminStatus: fetchOwnAdminStatusMock,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

const { AppShell } = await import("./AppShell");

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

async function openMenuAsMember() {
  observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
  fetchOwnAdminStatusMock.mockResolvedValue({ ok: true, isAdmin: false });
  const page = () => (
    <AppShell>
      <h1>Side</h1>
      <p>Innhold</p>
    </AppShell>
  );
  const { rerender } = render(page());
  await waitFor(() => expect(fetchOwnAdminStatusMock).toHaveBeenCalled());
  const trigger = screen.getByRole("button", { name: "Meny" });
  fireEvent.click(trigger);
  return { trigger, rerender: () => rerender(page()) };
}

describe("AppShell mobile drawer", () => {
  afterEach(() => {
    cleanup();
    mockPathname = "/";
    document.body.style.overflow = "";
  });

  it("is not rendered until the Meny trigger is pressed", () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));
    render(<AppShell />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a dialog with the navigation groups when Meny is pressed", async () => {
    await openMenuAsMember();

    const dialog = screen.getByRole("dialog", { name: "Hovednavigasjon" });
    expect(within(dialog).getByRole("link", { name: "Ferdigheter" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /logg ut/i })).toBeTruthy();
  });

  it("moves focus to the current link when it opens", async () => {
    mockPathname = "/me/goals";
    await openMenuAsMember();

    expect(document.activeElement?.textContent).toBe("Mål");
  });

  it("moves focus to the first link when no link is current", async () => {
    await openMenuAsMember();

    expect(document.activeElement?.textContent).toBe("Hjem");
  });

  it("closes on Escape and returns focus to Meny", async () => {
    const { trigger } = await openMenuAsMember();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes from the Lukk meny button and returns focus to Meny", async () => {
    const user = userEvent.setup();
    const { trigger } = await openMenuAsMember();

    await user.click(screen.getByRole("button", { name: "Lukk meny" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a click on the scrim and returns focus to Meny", async () => {
    const { trigger } = await openMenuAsMember();

    fireEvent.click(screen.getByTestId("drawer-scrim"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when a navigation link is followed", async () => {
    const user = userEvent.setup();
    await openMenuAsMember();

    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Mål" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the scrim out of the accessibility tree and out of the tab order", async () => {
    await openMenuAsMember();

    const scrim = screen.getByTestId("drawer-scrim");
    expect(scrim.getAttribute("aria-hidden")).toBe("true");
    expect(scrim.getAttribute("tabindex")).toBeNull();
  });

  it("makes the page content inert and aria-hidden while open, and restores both on close", async () => {
    await openMenuAsMember();

    const content = screen.getByText("Innhold").closest("[data-app-content]");
    expect(content?.hasAttribute("inert")).toBe(true);
    expect(content?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(content?.hasAttribute("inert")).toBe(false);
    expect(content?.getAttribute("aria-hidden")).toBeNull();
  });

  it("locks page scroll while open and restores it on close", async () => {
    document.body.style.overflow = "auto";
    await openMenuAsMember();

    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(document.body.style.overflow).toBe("auto");
  });

  it("traps Tab inside the drawer, wrapping from the last control to the first", async () => {
    const user = userEvent.setup();
    await openMenuAsMember();
    const dialog = screen.getByRole("dialog");
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button"));
    focusable[focusable.length - 1].focus();

    await user.tab();

    expect(document.activeElement).toBe(focusable[0]);
  });

  it("moves focus to the page heading after a navigation link closes the drawer", async () => {
    const user = userEvent.setup();
    const { rerender } = await openMenuAsMember();
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Mål" }));

    mockPathname = "/me/goals";
    rerender();

    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("uses the slide-in animation class and no transition class on the panel", async () => {
    await openMenuAsMember();

    const panel = screen.getByRole("dialog");
    expect(panel.className).toContain("animate-drawer-in");
    expect(panel.className).not.toMatch(/(^|\s)transition(-|\s|$)/);
  });

  it("is hidden at md and up", async () => {
    await openMenuAsMember();

    expect(screen.getByRole("dialog").className).toContain("md:hidden");
  });
});

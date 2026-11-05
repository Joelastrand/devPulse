// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountMenu } from "./AccountMenu";

describe("AccountMenu", () => {
  afterEach(cleanup);

  it("keeps its panel closed until the trigger is pressed", () => {
    render(<AccountMenu pathname="/" signOut={{ pending: false, onSignOut: vi.fn() }} />);

    const trigger = screen.getByRole("button", { name: /min konto/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: /min profil/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /logg ut/i })).toBeNull();
  });

  it("opens the panel with the profile link and sign-out action", () => {
    render(<AccountMenu pathname="/" signOut={{ pending: false, onSignOut: vi.fn() }} />);

    fireEvent.click(screen.getByRole("button", { name: /min konto/i }));

    expect(screen.getByRole("button", { name: /min konto/i }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: /min profil/i }).getAttribute("href")).toBe("/me/profile");
    expect(screen.getByRole("button", { name: /logg ut/i })).toBeTruthy();
  });

  it("moves focus into the panel when it opens", () => {
    render(<AccountMenu pathname="/" signOut={{ pending: false, onSignOut: vi.fn() }} />);

    fireEvent.click(screen.getByRole("button", { name: /min konto/i }));

    expect(document.activeElement).toBe(screen.getByRole("link", { name: /min profil/i }));
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<AccountMenu pathname="/" signOut={{ pending: false, onSignOut: vi.fn() }} />);
    const trigger = screen.getByRole("button", { name: /min konto/i });
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("link", { name: /min profil/i })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("exposes aria-haspopup and an accessible name on the trigger, with 44px minimum sizing", () => {
    render(<AccountMenu pathname="/" signOut={{ pending: false, onSignOut: vi.fn() }} />);

    const trigger = screen.getByRole("button", { name: /min konto/i });
    expect(trigger.getAttribute("aria-haspopup")).toBe("true");
    expect(trigger.className).toContain("min-h-11");
    expect(trigger.className).toContain("min-w-11");
  });

  it("moves between items with the arrow keys and wraps around", () => {
    render(<AccountMenu pathname="/" signOut={{ pending: false, onSignOut: vi.fn() }} />);

    fireEvent.click(screen.getByRole("button", { name: /min konto/i }));
    const profile = screen.getByRole("link", { name: /min profil/i });
    const logout = screen.getByRole("button", { name: /logg ut/i });

    expect(document.activeElement).toBe(profile);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(logout);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(profile);
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(logout);
  });

  it("closes when the pointer is pressed outside the menu", () => {
    render(
      <div>
        <p>utenfor</p>
        <AccountMenu pathname="/" signOut={{ pending: false, onSignOut: vi.fn() }} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /min konto/i }));

    fireEvent.pointerDown(screen.getByText("utenfor"));

    expect(screen.queryByRole("link", { name: /min profil/i })).toBeNull();
  });

  it("runs the sign-out action and closes the panel", () => {
    const onSignOut = vi.fn();
    render(<AccountMenu pathname="/" signOut={{ pending: false, onSignOut }} />);
    fireEvent.click(screen.getByRole("button", { name: /min konto/i }));

    fireEvent.click(screen.getByRole("button", { name: /logg ut/i }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: /min profil/i })).toBeNull();
  });

  it("marks the profile link as the current page on the profile route only", () => {
    const { rerender } = render(<AccountMenu pathname="/me/profile" signOut={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /min konto/i }));
    expect(screen.getByRole("link", { name: /min profil/i }).getAttribute("aria-current")).toBe("page");

    rerender(<AccountMenu pathname="/teams" signOut={undefined} />);
    expect(screen.getByRole("link", { name: /min profil/i }).getAttribute("aria-current")).toBeNull();
  });

  it("omits sign-out when no signed-in session is available", () => {
    render(<AccountMenu pathname="/" signOut={undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /min konto/i }));

    expect(screen.queryByRole("button", { name: /logg ut/i })).toBeNull();
  });
});

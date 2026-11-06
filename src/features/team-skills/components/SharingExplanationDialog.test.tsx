// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { SharingExplanationDialog } from "./SharingExplanationDialog";

afterEach(() => {
  cleanup();
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Om deling
      </button>
      {open && <SharingExplanationDialog teamName="Team Alfa" onClose={() => setOpen(false)} />}
    </div>
  );
}

describe("SharingExplanationDialog (TASK-010, SPEC BR-23)", () => {
  it("is a modal dialog labelled by its title and described by its explanation", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Om deling" }));

    const dialog = screen.getByRole("dialog", { name: "Om deling av kompetanse" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(dialog.textContent).toContain("«Team Alfa»");
  });

  it("moves focus into the dialog on open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Om deling" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Lukk" }));
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Om deling" });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes from the close button and from a backdrop click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Om deling" }));
    fireEvent.click(screen.getByRole("button", { name: "Lukk" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Om deling" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("traps Tab inside the dialog", () => {
    const onClose = vi.fn();
    render(<SharingExplanationDialog teamName="Team Alfa" onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Lukk" });
    close.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteConfirmation } from "./DeleteConfirmation";

const LABELS = {
  deleteLabel: "Slett tråd",
  deletingLabel: "Sletter…",
  confirmPrompt: "Er du sikker? Tråden slettes permanent.",
  confirmLabel: "Bekreft sletting",
  cancelLabel: "Avbryt",
};

describe("DeleteConfirmation", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders only the delete button in the idle state, never the confirmation prompt", () => {
    render(
      <DeleteConfirmation
        state={{ status: "idle" }}
        {...LABELS}
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
        onConfirmDelete={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: LABELS.deleteLabel })).toBeTruthy();
    expect(screen.queryByText(LABELS.confirmPrompt)).toBeNull();
  });

  it("requires an explicit confirmation click before onConfirmDelete fires", async () => {
    const onRequestDelete = vi.fn();
    const onConfirmDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <DeleteConfirmation
        state={{ status: "idle" }}
        {...LABELS}
        onRequestDelete={onRequestDelete}
        onCancelDelete={() => {}}
        onConfirmDelete={onConfirmDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: LABELS.deleteLabel }));

    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    expect(onConfirmDelete).not.toHaveBeenCalled();
  });

  it("shows the confirmation prompt and both actions once confirming", () => {
    render(
      <DeleteConfirmation
        state={{ status: "confirming" }}
        {...LABELS}
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
        onConfirmDelete={() => {}}
      />,
    );

    expect(screen.getByText(LABELS.confirmPrompt)).toBeTruthy();
    expect(screen.getByRole("button", { name: LABELS.confirmLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: LABELS.cancelLabel })).toBeTruthy();
    expect(screen.queryByRole("button", { name: LABELS.deleteLabel })).toBeNull();
  });

  it("calls onConfirmDelete only after the confirm button is clicked", async () => {
    const onConfirmDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <DeleteConfirmation
        state={{ status: "confirming" }}
        {...LABELS}
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
        onConfirmDelete={onConfirmDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: LABELS.confirmLabel }));

    expect(onConfirmDelete).toHaveBeenCalledTimes(1);
  });

  it("calls onCancelDelete and never onConfirmDelete when cancel is clicked", async () => {
    const onCancelDelete = vi.fn();
    const onConfirmDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <DeleteConfirmation
        state={{ status: "confirming" }}
        {...LABELS}
        onRequestDelete={() => {}}
        onCancelDelete={onCancelDelete}
        onConfirmDelete={onConfirmDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: LABELS.cancelLabel }));

    expect(onCancelDelete).toHaveBeenCalledTimes(1);
    expect(onConfirmDelete).not.toHaveBeenCalled();
  });

  it("shows a pending, disabled delete button while pending", () => {
    render(
      <DeleteConfirmation
        state={{ status: "pending" }}
        {...LABELS}
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
        onConfirmDelete={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: new RegExp(LABELS.deletingLabel) });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("shows an error message via role=alert", () => {
    render(
      <DeleteConfirmation
        state={{ status: "error", message: "Kunne ikke slette tråden. Prøv igjen." }}
        {...LABELS}
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
        onConfirmDelete={() => {}}
      />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(/kunne ikke slette/i);
  });

  it("disambiguates its accessible button name with the provided context when several instances render together", () => {
    render(
      <DeleteConfirmation
        state={{ status: "idle" }}
        {...LABELS}
        context="10. jan. 2026"
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
        onConfirmDelete={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: `${LABELS.deleteLabel} – 10. jan. 2026` })).toBeTruthy();
  });
});

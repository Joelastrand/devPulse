// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createAdminSkillTreeMock = vi.fn();

vi.mock("../client/skill-trees-gateway", () => ({
  createAdminSkillTree: createAdminSkillTreeMock,
}));

const { SkillTreeCreationForm } = await import("./SkillTreeCreationForm");

describe("SkillTreeCreationForm", () => {
  afterEach(() => {
    cleanup();
    createAdminSkillTreeMock.mockReset();
  });

  it("starts with exactly two stage-label rows", () => {
    render(<SkillTreeCreationForm token="token" onCreated={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText("Stadium 1")).toBeTruthy();
    expect(screen.getByLabelText("Stadium 2")).toBeTruthy();
    expect(screen.queryByLabelText("Stadium 3")).toBeNull();
  });

  it("adds a stage row via the add-stage button, up to the 20-node boundary", async () => {
    const user = userEvent.setup();
    render(<SkillTreeCreationForm token="token" onCreated={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /legg til stadium/i }));

    expect(screen.getByLabelText("Stadium 3")).toBeTruthy();

    // Fill up to 20 rows; the add button must then be disabled (structural
    // 20-node boundary, not merely a validation message).
    for (let i = 4; i <= 20; i++) {
      await user.click(screen.getByRole("button", { name: /legg til stadium/i }));
    }

    expect(screen.getByLabelText("Stadium 20")).toBeTruthy();
    expect(screen.queryByLabelText("Stadium 21")).toBeNull();
    expect(screen.getByRole("button", { name: /legg til stadium/i }).hasAttribute("disabled")).toBe(true);
  });

  it("removes a stage row via its remove button, never going below the 2-node boundary", async () => {
    const user = userEvent.setup();
    render(<SkillTreeCreationForm token="token" onCreated={vi.fn()} onCancel={vi.fn()} />);

    const removeButtons = screen.getAllByRole("button", { name: /fjern stadium/i });
    expect(removeButtons).toHaveLength(2);
    // Both remove buttons are disabled at the 2-node floor.
    expect(removeButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);

    await user.click(screen.getByRole("button", { name: /legg til stadium/i }));
    const removeButtonsAfterAdd = screen.getAllByRole("button", { name: /fjern stadium/i });
    expect(removeButtonsAfterAdd.every((button) => button.hasAttribute("disabled"))).toBe(false);

    await user.click(removeButtonsAfterAdd[2]);
    expect(screen.queryByLabelText("Stadium 3")).toBeNull();
  });

  it("shows a client-side validation error for fewer than 2 valid labels, without calling the server", async () => {
    const user = userEvent.setup();
    render(<SkillTreeCreationForm token="token" onCreated={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/navn på kompetanseområdet/i), "Containers");
    await user.type(screen.getByLabelText("Stadium 1"), "ab"); // below 3-char minimum
    await user.type(screen.getByLabelText("Stadium 2"), "Pilot fase");

    await user.click(screen.getByRole("button", { name: /opprett kompetanseområde/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/kontroller navnet/i);
    expect(createAdminSkillTreeMock).not.toHaveBeenCalled();
  });

  it("submits a valid creation and resets the form on success", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    createAdminSkillTreeMock.mockResolvedValue({ ok: true, treeId: "tree-1" });

    render(<SkillTreeCreationForm token="a-token" onCreated={onCreated} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/navn på kompetanseområdet/i), "Containere");
    await user.type(screen.getByLabelText("Stadium 1"), "Fundamentals");
    await user.type(screen.getByLabelText("Stadium 2"), "Pilotdrift");

    await user.click(screen.getByRole("button", { name: /opprett kompetanseområde/i }));

    expect(createAdminSkillTreeMock).toHaveBeenCalledWith("a-token", "Containere", [
      "Fundamentals",
      "Pilotdrift",
    ]);
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText(/navn på kompetanseområdet/i) as HTMLInputElement).value).toBe("");
  });

  it("shows a server-side error and does not call onCreated when creation fails", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    createAdminSkillTreeMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    render(<SkillTreeCreationForm token="a-token" onCreated={onCreated} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/navn på kompetanseområdet/i), "Containere");
    await user.type(screen.getByLabelText("Stadium 1"), "Fundamentals");
    await user.type(screen.getByLabelText("Stadium 2"), "Pilotdrift");
    await user.click(screen.getByRole("button", { name: /opprett kompetanseområde/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("does not fire a second create request from repeated clicks while one is already in flight", async () => {
    const user = userEvent.setup();
    let resolveCreate: (value: unknown) => void = () => {};
    createAdminSkillTreeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    render(<SkillTreeCreationForm token="a-token" onCreated={vi.fn()} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText(/navn på kompetanseområdet/i), "Containere");
    await user.type(screen.getByLabelText("Stadium 1"), "Fundamentals");
    await user.type(screen.getByLabelText("Stadium 2"), "Pilotdrift");

    const submitButton = screen.getByRole("button", { name: /opprett kompetanseområde/i });
    await user.click(submitButton);
    expect(submitButton.hasAttribute("disabled")).toBe(true);

    await user.click(submitButton);
    expect(createAdminSkillTreeMock).toHaveBeenCalledTimes(1);

    resolveCreate({ ok: true, treeId: "tree-1" });
  });

  it("calls onCancel without submitting when the cancel button is clicked (docs/features/ui-refresh/SPEC.md — BR-14)", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<SkillTreeCreationForm token="a-token" onCreated={vi.fn()} onCancel={onCancel} />);

    await user.type(screen.getByLabelText(/navn på kompetanseområdet/i), "Containere");
    await user.click(screen.getByRole("button", { name: /avbryt/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(createAdminSkillTreeMock).not.toHaveBeenCalled();
  });
});

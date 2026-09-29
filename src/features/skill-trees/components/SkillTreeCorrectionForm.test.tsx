// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminSkillTreeEntry } from "../client/skill-trees-gateway";

const correctAdminSkillTreeMock = vi.fn();

vi.mock("../client/skill-trees-gateway", () => ({
  correctAdminSkillTree: correctAdminSkillTreeMock,
}));

const { SkillTreeCorrectionForm } = await import("./SkillTreeCorrectionForm");

const TREE: AdminSkillTreeEntry = {
  treeId: "tree-1",
  name: "Containere",
  nodes: [
    { nodeId: "node-0", label: "Fundamentals", order: 0 },
    { nodeId: "node-1", label: "Pilotdrift", order: 1 },
    { nodeId: "node-2", label: "Produksjon", order: 2 },
  ],
};

describe("SkillTreeCorrectionForm", () => {
  afterEach(() => {
    cleanup();
    correctAdminSkillTreeMock.mockReset();
  });

  it("pre-fills the name and every stage label from the target tree exactly", () => {
    render(<SkillTreeCorrectionForm tree={TREE} token="token" onSuccess={vi.fn()} onCancel={vi.fn()} />);

    expect((screen.getByLabelText(/navn på kompetanseområdet/i) as HTMLInputElement).value).toBe(
      "Containere",
    );
    expect((screen.getByLabelText("Stadium 1") as HTMLInputElement).value).toBe("Fundamentals");
    expect((screen.getByLabelText("Stadium 2") as HTMLInputElement).value).toBe("Pilotdrift");
    expect((screen.getByLabelText("Stadium 3") as HTMLInputElement).value).toBe("Produksjon");
  });

  it("renders no add or remove-row control anywhere — the row count is structurally fixed", () => {
    render(<SkillTreeCorrectionForm tree={TREE} token="token" onSuccess={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /legg til stadium/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /fjern stadium/i })).toBeNull();
    expect(screen.queryByLabelText("Stadium 4")).toBeNull();
  });

  it("submits a name-only correction, resubmitting the unchanged existing labels", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    correctAdminSkillTreeMock.mockResolvedValue({ ok: true });

    render(<SkillTreeCorrectionForm tree={TREE} token="a-token" onSuccess={onSuccess} onCancel={vi.fn()} />);

    const nameInput = screen.getByLabelText(/navn på kompetanseområdet/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Containere (rettet)");

    await user.click(screen.getByRole("button", { name: /lagre rettelse/i }));

    expect(correctAdminSkillTreeMock).toHaveBeenCalledWith("a-token", "tree-1", "Containere (rettet)", [
      "Fundamentals",
      "Pilotdrift",
      "Produksjon",
    ]);
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("submits a label-only correction, resubmitting the unchanged existing name", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    correctAdminSkillTreeMock.mockResolvedValue({ ok: true });

    render(<SkillTreeCorrectionForm tree={TREE} token="a-token" onSuccess={onSuccess} onCancel={vi.fn()} />);

    const stage2 = screen.getByLabelText("Stadium 2");
    await user.clear(stage2);
    await user.type(stage2, "Pilot (rettet)");

    await user.click(screen.getByRole("button", { name: /lagre rettelse/i }));

    expect(correctAdminSkillTreeMock).toHaveBeenCalledWith("a-token", "tree-1", "Containere", [
      "Fundamentals",
      "Pilot (rettet)",
      "Produksjon",
    ]);
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("shows a server-side error and does not call onSuccess when correction fails", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    correctAdminSkillTreeMock.mockResolvedValue({ ok: false, error: "tree_not_found" });

    render(<SkillTreeCorrectionForm tree={TREE} token="a-token" onSuccess={onSuccess} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /lagre rettelse/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/finnes ikke lenger/i);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("calls onCancel without submitting when the cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<SkillTreeCorrectionForm tree={TREE} token="a-token" onSuccess={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: /avbryt/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(correctAdminSkillTreeMock).not.toHaveBeenCalled();
  });

  it("shows a client-side validation error for a too-short label, without calling the server", async () => {
    const user = userEvent.setup();
    render(<SkillTreeCorrectionForm tree={TREE} token="a-token" onSuccess={vi.fn()} onCancel={vi.fn()} />);

    const stage1 = screen.getByLabelText("Stadium 1");
    await user.clear(stage1);
    await user.type(stage1, "ab");

    await user.click(screen.getByRole("button", { name: /lagre rettelse/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/kontroller navnet/i);
    expect(correctAdminSkillTreeMock).not.toHaveBeenCalled();
  });

  it("wires aria-invalid/aria-describedby on the name/stage fields to the validation alert (docs/features/ui-refresh/SPEC.md — BR-9)", async () => {
    const user = userEvent.setup();
    render(<SkillTreeCorrectionForm tree={TREE} token="a-token" onSuccess={vi.fn()} onCancel={vi.fn()} />);

    const stage1 = screen.getByLabelText("Stadium 1");
    await user.clear(stage1);
    await user.type(stage1, "ab");
    await user.click(screen.getByRole("button", { name: /lagre rettelse/i }));

    const alert = await screen.findByRole("alert");
    const nameField = screen.getByLabelText(/navn på kompetanseområdet/i);

    expect(nameField.getAttribute("aria-invalid")).toBe("true");
    expect(nameField.getAttribute("aria-describedby")).toBe(alert.id);
    expect(stage1.getAttribute("aria-invalid")).toBe("true");
    expect(stage1.getAttribute("aria-describedby")).toBe(alert.id);
  });
});

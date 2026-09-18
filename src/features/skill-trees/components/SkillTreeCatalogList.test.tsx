// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminSkillTreeEntry } from "../client/skill-trees-gateway";

const correctAdminSkillTreeMock = vi.fn();

vi.mock("../client/skill-trees-gateway", () => ({
  correctAdminSkillTree: correctAdminSkillTreeMock,
}));

const { SkillTreeCatalogList } = await import("./SkillTreeCatalogList");

const TREES: AdminSkillTreeEntry[] = [
  {
    treeId: "tree-1",
    name: "Containere",
    nodes: [
      { nodeId: "node-0", label: "Fundamentals", order: 0 },
      { nodeId: "node-1", label: "Pilotdrift", order: 1 },
    ],
  },
];

describe("SkillTreeCatalogList", () => {
  afterEach(() => {
    cleanup();
    correctAdminSkillTreeMock.mockReset();
  });

  it("shows a Norwegian loading state", () => {
    render(<SkillTreeCatalogList state={{ status: "loading" }} token="token" onChanged={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("shows a generic error state", () => {
    render(<SkillTreeCatalogList state={{ status: "error" }} token="token" onChanged={vi.fn()} />);

    expect(screen.getByRole("alert").textContent).toMatch(/noe gikk galt/i);
  });

  it("shows an empty state for zero trees", () => {
    render(<SkillTreeCatalogList state={{ status: "loaded", trees: [] }} token="token" onChanged={vi.fn()} />);

    expect(screen.getByText(/ingen kompetanseområder/i)).toBeTruthy();
  });

  it("renders each tree's name and full ordered stage list, plus a correction action", () => {
    render(<SkillTreeCatalogList state={{ status: "loaded", trees: TREES }} token="token" onChanged={vi.fn()} />);

    expect(screen.getByText("Containere")).toBeTruthy();
    expect(screen.getByText("Fundamentals")).toBeTruthy();
    expect(screen.getByText("Pilotdrift")).toBeTruthy();
    expect(screen.getByRole("button", { name: /rett opp/i })).toBeTruthy();
  });

  it("never renders a total-count or 'showing all trees' claim", () => {
    const { container } = render(
      <SkillTreeCatalogList state={{ status: "loaded", trees: TREES }} token="token" onChanged={vi.fn()} />,
    );

    expect(container.textContent).not.toMatch(/showing all|totalt|alle trær|500/i);
  });

  it("opens the correction form for a tree and refreshes the catalog on a successful correction", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    correctAdminSkillTreeMock.mockResolvedValue({ ok: true });

    render(<SkillTreeCatalogList state={{ status: "loaded", trees: TREES }} token="a-token" onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: /rett opp/i }));

    expect((screen.getByLabelText(/navn på kompetanseområdet/i) as HTMLInputElement).value).toBe("Containere");

    await user.click(screen.getByRole("button", { name: /lagre rettelse/i }));

    expect(correctAdminSkillTreeMock).toHaveBeenCalledWith("a-token", "tree-1", "Containere", [
      "Fundamentals",
      "Pilotdrift",
    ]);
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("closes the correction form without refreshing when cancelled", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();

    render(<SkillTreeCatalogList state={{ status: "loaded", trees: TREES }} token="a-token" onChanged={onChanged} />);

    await user.click(screen.getByRole("button", { name: /rett opp/i }));
    await user.click(screen.getByRole("button", { name: /avbryt/i }));

    expect(screen.queryByLabelText(/navn på kompetanseområdet/i)).toBeNull();
    expect(screen.getByRole("button", { name: /rett opp/i })).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

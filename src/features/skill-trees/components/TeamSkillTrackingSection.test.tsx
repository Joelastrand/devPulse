// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminSkillTreeEntry } from "../client/skill-trees-gateway";
import {
  TeamSkillTrackingSection,
  type TeamSkillRowActionState,
  type TeamSkillTrackingState,
} from "./TeamSkillTrackingSection";

const TREES: AdminSkillTreeEntry[] = [
  {
    treeId: "tree-1",
    name: "Containere",
    nodes: [
      { nodeId: "node-0", label: "Fundamentals", order: 0 },
      { nodeId: "node-1", label: "Pilotdrift", order: 1 },
      { nodeId: "node-2", label: "Produksjon", order: 2 },
    ],
  },
  {
    treeId: "tree-2",
    name: "Observability",
    nodes: [
      { nodeId: "node-0", label: "Basics", order: 0 },
      { nodeId: "node-1", label: "Advanced", order: 1 },
    ],
  },
];

const NO_TRACKING: Record<string, TeamSkillTrackingState> = {};
const NO_ACTIONS: Record<string, TeamSkillRowActionState> = {};

describe("TeamSkillTrackingSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a Norwegian loading state", () => {
    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loading" }}
        tracking={NO_TRACKING}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("shows a generic error state", () => {
    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "error" }}
        tracking={NO_TRACKING}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(/noe gikk galt/i);
  });

  it("shows an empty state when the catalog has no trees", () => {
    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: [] }}
        tracking={NO_TRACKING}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByText(/ingen kompetanseområder/i)).toBeTruthy();
  });

  it("offers only untracked trees in the start-tracking picker", () => {
    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={{ "tree-1": { status: "tracked", currentNodeId: null } }}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /start sporing – observability/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start sporing – containere/i })).toBeNull();
  });

  it("hides the start-tracking picker for a disabled team", () => {
    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={NO_TRACKING}
        actions={NO_ACTIONS}
        teamDisabled={true}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /start sporing/i })).toBeNull();
    expect(screen.getByText(/teamet er deaktivert/i)).toBeTruthy();
  });

  it("calls onStart with the tree id when a start button is clicked", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={NO_TRACKING}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={onStart}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /start sporing – containere/i }));

    expect(onStart).toHaveBeenCalledWith("tree-1");
  });

  it("picker recomputes correctly after a tree becomes tracked", () => {
    const { rerender } = render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={NO_TRACKING}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /start sporing – containere/i })).toBeTruthy();

    rerender(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={{ "tree-1": { status: "tracked", currentNodeId: null } }}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /start sporing – containere/i })).toBeNull();
    expect(screen.getByRole("combobox", { name: /sett stadium – containere/i })).toBeTruthy();
  });

  it("shows a tracked tree's full ordered stage list with the current stage marked, and a not-started note when currentNodeId is null", () => {
    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={{
          "tree-1": { status: "tracked", currentNodeId: "node-1" },
          "tree-2": { status: "tracked", currentNodeId: null },
        }}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Fundamentals").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Produksjon").length).toBeGreaterThan(0);
    const currentItem = screen
      .getAllByText("Pilotdrift")
      .map((el) => el.closest("li"))
      .find((li): li is HTMLLIElement => li !== null);
    expect(currentItem?.getAttribute("aria-current")).toBe("step");

    expect(screen.getAllByText(/ikke startet/i).length).toBeGreaterThan(0);
  });

  it("the stage select offers every node, including one earlier than the current stage", () => {
    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={{ "tree-1": { status: "tracked", currentNodeId: "node-2" } }}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: /sett stadium – containere/i });
    const options = within(select).getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(["node-0", "node-1", "node-2"]);
  });

  it("calls onSetStage with a backward-moving nodeId when selected", async () => {
    const user = userEvent.setup();
    const onSetStage = vi.fn();

    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={{ "tree-1": { status: "tracked", currentNodeId: "node-2" } }}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={onSetStage}
        onStop={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: /sett stadium – containere/i });
    await user.selectOptions(select, "node-0");

    expect(onSetStage).toHaveBeenCalledWith("tree-1", "node-0");
  });

  it("the stage-setting control and stop-tracking action are available and functional on a disabled team", async () => {
    const user = userEvent.setup();
    const onSetStage = vi.fn();
    const onStop = vi.fn();

    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={{ "tree-1": { status: "tracked", currentNodeId: "node-0" } }}
        actions={NO_ACTIONS}
        teamDisabled={true}
        onStart={vi.fn()}
        onSetStage={onSetStage}
        onStop={onStop}
      />,
    );

    const select = screen.getByRole("combobox", { name: /sett stadium – containere/i });
    expect(select.hasAttribute("disabled")).toBe(false);
    await user.selectOptions(select, "node-1");
    expect(onSetStage).toHaveBeenCalledWith("tree-1", "node-1");

    const stopButton = screen.getByRole("button", { name: /stopp sporing – containere/i });
    expect(stopButton.hasAttribute("disabled")).toBe(false);
    await user.click(stopButton);
    expect(onStop).toHaveBeenCalledWith("tree-1");
  });

  it("calls onStop with the tree id when the stop button is clicked", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();

    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={{ "tree-1": { status: "tracked", currentNodeId: "node-0" } }}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={onStop}
      />,
    );

    await user.click(screen.getByRole("button", { name: /stopp sporing – containere/i }));

    expect(onStop).toHaveBeenCalledWith("tree-1");
  });

  it("shows a row-level error message without affecting other rows", () => {
    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={{ "tree-1": { status: "tracked", currentNodeId: "node-0" } }}
        actions={{ "tree-1": { status: "error", message: "Noe gikk galt. Prøv igjen." } }}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByText("Noe gikk galt. Prøv igjen.")).toBeTruthy();
  });

  it("renders no individual/member-identity data anywhere in its output", () => {
    const { container } = render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: TREES }}
        tracking={{ "tree-1": { status: "tracked", currentNodeId: "node-0" } }}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(container.textContent).not.toMatch(/uid|@|updatedBy|createdBy/i);
  });

  it("renders a malicious-looking tree name/node label inertly as plain text, never as HTML", () => {
    const maliciousTrees: AdminSkillTreeEntry[] = [
      {
        treeId: "tree-evil",
        name: '<img src=x onerror="window.__xss=true">',
        nodes: [{ nodeId: "node-0", label: "<script>window.__xss2=true</script>", order: 0 }],
      },
    ];

    render(
      <TeamSkillTrackingSection
        catalogState={{ status: "loaded", trees: maliciousTrees }}
        tracking={{ "tree-evil": { status: "tracked", currentNodeId: "node-0" } }}
        actions={NO_ACTIONS}
        teamDisabled={false}
        onStart={vi.fn()}
        onSetStage={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByText('<img src=x onerror="window.__xss=true">')).toBeTruthy();
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined();
    expect((window as unknown as { __xss2?: boolean }).__xss2).toBeUndefined();
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(document.querySelectorAll("script").length).toBe(0);
  });
});

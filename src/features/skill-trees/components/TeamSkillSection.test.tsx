// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamSkillSection, type TeamSkillSectionState } from "./TeamSkillSection";

afterEach(() => {
  cleanup();
});

const CONTAINERS_SKILL = {
  treeId: "tree-1",
  name: "Containers",
  nodes: [
    { nodeId: "node-0", label: "Fundamentals", order: 0 },
    { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
    { nodeId: "node-2", label: "Production rollout", order: 2 },
  ],
  currentNodeId: "node-1",
};

const OBSERVABILITY_SKILL = {
  treeId: "tree-2",
  name: "Observability",
  nodes: [
    { nodeId: "node-0", label: "Basic logging", order: 0 },
    { nodeId: "node-1", label: "Full tracing", order: 1 },
  ],
  currentNodeId: null,
};

describe("TeamSkillSection", () => {
  it("shows a Norwegian loading state", () => {
    const state: TeamSkillSectionState = { status: "loading" };
    render(<TeamSkillSection state={state} />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("shows a Norwegian error state", () => {
    const state: TeamSkillSectionState = { status: "error" };
    render(<TeamSkillSection state={state} />);

    expect(screen.getByRole("alert").textContent).toMatch(/noe gikk galt/i);
  });

  it("shows a Norwegian empty state when the team tracks nothing", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [] };
    render(<TeamSkillSection state={state} />);

    expect(screen.getByRole("status").textContent).toMatch(/ingen|sporer/i);
  });

  it("renders a single tracked tree's full ordered stage list", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL] };
    render(<TeamSkillSection state={state} />);

    expect(screen.getByText("Containers")).toBeTruthy();
    expect(screen.getByText("Fundamentals")).toBeTruthy();
    expect(screen.getByText("Evaluate alternatives")).toBeTruthy();
    expect(screen.getByText("Production rollout")).toBeTruthy();
  });

  it("renders multiple tracked trees, each with its own stage list", () => {
    const state: TeamSkillSectionState = {
      status: "loaded",
      skills: [CONTAINERS_SKILL, OBSERVABILITY_SKILL],
    };
    render(<TeamSkillSection state={state} />);

    expect(screen.getByText("Containers")).toBeTruthy();
    expect(screen.getByText("Observability")).toBeTruthy();
    expect(screen.getByText("Basic logging")).toBeTruthy();
    expect(screen.getByText("Full tracing")).toBeTruthy();
  });

  it("marks the current stage with both aria-current='step' and visible text — never color alone", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL] };
    render(<TeamSkillSection state={state} />);

    const currentItem = screen.getByText("Evaluate alternatives").closest("li");
    expect(currentItem?.getAttribute("aria-current")).toBe("step");
    expect(currentItem?.textContent).toMatch(/nåværende steg/i);

    const otherItem = screen.getByText("Fundamentals").closest("li");
    expect(otherItem?.getAttribute("aria-current")).toBeNull();
    expect(otherItem?.textContent).not.toMatch(/nåværende steg/i);
  });

  it("renders a distinct 'not started' state for a currentNodeId of null, with no current-stage marker", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [OBSERVABILITY_SKILL] };
    render(<TeamSkillSection state={state} />);

    expect(screen.getByText(/ikke startet/i)).toBeTruthy();
    expect(screen.queryByText(/nåværende steg/i)).toBeNull();
    for (const item of screen.getAllByRole("listitem")) {
      expect(item.getAttribute("aria-current")).toBeNull();
    }
  });

  it("renders as a semantic ordered list, never a graphical/canvas element", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL] };
    const { container } = render(<TeamSkillSection state={state} />);

    expect(container.querySelector("ol")).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("is strictly read-only — no start/set-stage/stop control of any kind", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL, OBSERVABILITY_SKILL] };
    render(<TeamSkillSection state={state} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("never renders an identity-shaped value (uid/email/createdBy/updatedBy) anywhere in its output", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL, OBSERVABILITY_SKILL] };
    const { container } = render(<TeamSkillSection state={state} />);

    expect(container.textContent).not.toMatch(/uid|email|createdBy|updatedBy|@/i);
  });

  it("renders untrusted-looking name/label content as ordinary text, never HTML injection (XSS)", () => {
    const maliciousSkill = {
      treeId: "tree-3",
      name: "<img src=x onerror=alert(1)>Malicious Tree",
      nodes: [
        { nodeId: "node-0", label: "<script>alert('xss')</script>Stage One", order: 0 },
      ],
      currentNodeId: "node-0",
    };
    const state: TeamSkillSectionState = { status: "loaded", skills: [maliciousSkill] };
    const { container } = render(<TeamSkillSection state={state} />);

    // Rendered as literal text content, never parsed as markup.
    expect(screen.getByText(maliciousSkill.name)).toBeTruthy();
    expect(screen.getByText(/Stage One/)).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});

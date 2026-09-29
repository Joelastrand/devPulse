// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { SkillTreeNodeView } from "../client/skill-trees-gateway";
import { SkillProgressPath, deriveSkillProgressPath } from "./SkillProgressPath";

afterEach(cleanup);

const ABCD: SkillTreeNodeView[] = [
  { nodeId: "node-0", label: "Alfa", order: 0 },
  { nodeId: "node-1", label: "Bravo", order: 1 },
  { nodeId: "node-2", label: "Charlie", order: 2 },
  { nodeId: "node-3", label: "Delta", order: 3 },
];

function renderPath(currentNodeId: string | null, nodes: SkillTreeNodeView[] = ABCD) {
  return render(<SkillProgressPath name="Containere" nodes={nodes} currentNodeId={currentNodeId} />);
}

/** Per-stage state as a user reads it: the visible state text inside each list item. */
function states() {
  return within(screen.getByRole("list", { name: "Containere" }))
    .getAllByRole("listitem")
    .map((li) => {
      const text = li.textContent ?? "";
      if (text.includes("Tidligere steg")) return "earlier";
      if (text.includes("Nåværende steg")) return "current";
      if (text.includes("Kommende steg")) return "upcoming";
      return "none";
    });
}

describe("deriveSkillProgressPath", () => {
  it("derives positional states around a middle current stage", () => {
    const { stages, currentIndex } = deriveSkillProgressPath(ABCD, "node-2");
    expect(stages.map((s) => s.state)).toEqual(["earlier", "earlier", "current", "upcoming"]);
    expect(currentIndex).toBe(2);
  });

  it("first current leaves the rest upcoming; last current makes the rest earlier", () => {
    expect(deriveSkillProgressPath(ABCD, "node-0").stages.map((s) => s.state)).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(deriveSkillProgressPath(ABCD, "node-3").stages.map((s) => s.state)).toEqual([
      "earlier",
      "earlier",
      "earlier",
      "current",
    ]);
  });

  it("null and an unmatched id both yield all upcoming with no current index", () => {
    for (const id of [null, "node-99"]) {
      const { stages, currentIndex } = deriveSkillProgressPath(ABCD, id);
      expect(stages.every((s) => s.state === "upcoming")).toBe(true);
      expect(currentIndex).toBeNull();
    }
  });

  it("sorts by order without mutating the input array", () => {
    const input = [ABCD[2], ABCD[0], ABCD[3], ABCD[1]];
    const { stages } = deriveSkillProgressPath(input, "node-1");
    expect(stages.map((s) => s.node.label)).toEqual(["Alfa", "Bravo", "Charlie", "Delta"]);
    expect(stages.map((s) => s.state)).toEqual(["earlier", "current", "upcoming", "upcoming"]);
    expect(input.map((n) => n.label)).toEqual(["Charlie", "Alfa", "Delta", "Bravo"]);
  });
});

describe("SkillProgressPath", () => {
  it("renders earlier/current/upcoming for a middle current stage with a team-scoped summary", () => {
    renderPath("node-2");
    expect(states()).toEqual(["earlier", "earlier", "current", "upcoming"]);
    expect(screen.getByText(/Teamets nåværende steg:/).textContent).toBe(
      "Teamets nåværende steg: Charlie (steg 3 av 4)",
    );
  });

  it("renders current first and current last", () => {
    renderPath("node-0");
    expect(states()).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
    cleanup();
    renderPath("node-3");
    expect(states()).toEqual(["earlier", "earlier", "earlier", "current"]);
  });

  it("null: all upcoming, no aria-current, summary says Ikke startet", () => {
    const { container } = renderPath(null);
    expect(states()).toEqual(["upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(container.querySelector("[aria-current]")).toBeNull();
    expect(screen.getByText(/Teamets nåværende steg:/).textContent).toBe("Teamets nåværende steg: Ikke startet");
  });

  it("invalid non-null id: all upcoming, no aria-current, no summary and no Ikke startet", () => {
    const { container } = renderPath("node-99");
    expect(states()).toEqual(["upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(container.querySelector("[aria-current]")).toBeNull();
    expect(screen.queryByText(/Ikke startet/)).toBeNull();
    expect(screen.queryByText(/Teamets nåværende steg/)).toBeNull();
    expect(screen.queryByText("Nåværende steg")).toBeNull();
  });

  it("recomputes on backward movement: C -> B makes C upcoming", () => {
    const { rerender } = renderPath("node-2");
    expect(states()).toEqual(["earlier", "earlier", "current", "upcoming"]);
    rerender(<SkillProgressPath name="Containere" nodes={ABCD} currentNodeId="node-1" />);
    expect(states()).toEqual(["earlier", "current", "upcoming", "upcoming"]);
  });

  it("renders unsorted input in ascending order and leaves the input untouched", () => {
    const input = [ABCD[3], ABCD[1], ABCD[0], ABCD[2]];
    renderPath("node-1", input);
    const order = screen
      .getAllByRole("listitem")
      .map((li) => ["Alfa", "Bravo", "Charlie", "Delta"].findIndex((label) => li.textContent?.includes(label)));
    expect(order).toEqual([0, 1, 2, 3]);
    expect(input.map((n) => n.label)).toEqual(["Delta", "Bravo", "Alfa", "Charlie"]);
  });

  it("is an accessibly named ordered list with aria-current=step only on the current stage", () => {
    const { container } = renderPath("node-1");
    expect(screen.getByRole("list", { name: "Containere" }).tagName).toBe("OL");
    const current = container.querySelectorAll("[aria-current]");
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("aria-current")).toBe("step");
    expect(current[0].textContent).toContain("Bravo");
  });

  it("shows visible state text for every stage and hides label-free decoration from assistive tech", () => {
    const { container } = renderPath("node-1");
    for (const li of screen.getAllByRole("listitem")) {
      expect(li.textContent).toMatch(/Tidligere steg|Nåværende steg|Kommende steg/);
    }
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThan(0);
    for (const el of hidden) {
      for (const node of ABCD) expect(el.textContent).not.toContain(node.label);
      expect(el.textContent).not.toMatch(/steg/);
    }
  });

  it("has no interactive or focusable stages", () => {
    const { container } = renderPath("node-1");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.querySelector("[tabindex], button, a, input, select")).toBeNull();
  });

  it("renders a 100-character label in full", () => {
    const long = "L".repeat(100);
    renderPath("node-0", [
      { nodeId: "node-0", label: long, order: 0 },
      { nodeId: "node-1", label: "Kort", order: 1 },
    ]);
    expect(screen.getAllByText(long).length).toBeGreaterThan(0);
  });

  it("renders all 20 stages", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ nodeId: `node-${i}`, label: `Steg ${i}`, order: i }));
    renderPath("node-19", nodes);
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    expect(states().filter((s) => s === "earlier")).toHaveLength(19);
  });

  it("uses no Fullført or individual framing", () => {
    const { container } = renderPath("node-1");
    expect(container.textContent).not.toMatch(/Fullført|\b(du|din|ditt|min)\b/i);
  });
});

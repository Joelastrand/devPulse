import { describe, expect, it } from "vitest";
import {
  buildSkillNodes,
  validateSkillNodeLabels,
  validateSkillTreeName,
} from "./skill-tree-input";

describe("validateSkillTreeName", () => {
  it("accepts a valid trimmed name", () => {
    expect(validateSkillTreeName("  Container fundamentals  ")).toEqual({
      ok: true,
      name: "Container fundamentals",
    });
  });

  it("accepts the minimum boundary length (3 chars)", () => {
    expect(validateSkillTreeName("abc")).toEqual({ ok: true, name: "abc" });
  });

  it("rejects one below the minimum boundary length (2 chars)", () => {
    expect(validateSkillTreeName("ab")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("accepts the maximum boundary length (100 chars)", () => {
    const name = "a".repeat(100);
    expect(validateSkillTreeName(name)).toEqual({ ok: true, name });
  });

  it("rejects one above the maximum boundary length (101 chars)", () => {
    expect(validateSkillTreeName("a".repeat(101))).toEqual({
      ok: false,
      error: "invalid_input",
    });
  });

  it("rejects a whitespace-only value", () => {
    expect(validateSkillTreeName("     ")).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects a non-string value", () => {
    expect(validateSkillTreeName(42)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateSkillTreeName(undefined)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateSkillTreeName(null)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("never truncates an over-length value", () => {
    const overLong = "a".repeat(150);
    const result = validateSkillTreeName(overLong);
    expect(result.ok).toBe(false);
  });
});

describe("validateSkillNodeLabels", () => {
  it("accepts a valid array of trimmed labels", () => {
    expect(validateSkillNodeLabels(["  Evaluate  ", "Pilot"])).toEqual({
      ok: true,
      labels: ["Evaluate", "Pilot"],
    });
  });

  it("accepts exactly 2 entries (minimum boundary)", () => {
    const labels = ["Stage one", "Stage two"];
    expect(validateSkillNodeLabels(labels)).toEqual({ ok: true, labels });
  });

  it("rejects exactly 1 entry (below minimum)", () => {
    expect(validateSkillNodeLabels(["Only stage"])).toEqual({
      ok: false,
      error: "invalid_input",
    });
  });

  it("accepts exactly 20 entries (maximum boundary)", () => {
    const labels = Array.from({ length: 20 }, (_, i) => `Stage ${i}`);
    expect(validateSkillNodeLabels(labels)).toEqual({ ok: true, labels });
  });

  it("rejects exactly 21 entries (above maximum)", () => {
    const labels = Array.from({ length: 21 }, (_, i) => `Stage ${i}`);
    expect(validateSkillNodeLabels(labels)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects an empty array", () => {
    expect(validateSkillNodeLabels([])).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects a non-array value", () => {
    expect(validateSkillNodeLabels("not an array")).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(validateSkillNodeLabels(undefined)).toEqual({ ok: false, error: "invalid_input" });
    expect(validateSkillNodeLabels(null)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("rejects a label at the minimum-length boundary minus one (2 chars)", () => {
    expect(validateSkillNodeLabels(["ab", "Valid label"])).toEqual({
      ok: false,
      error: "invalid_input",
    });
  });

  it("accepts a label at the exact minimum-length boundary (3 chars)", () => {
    expect(validateSkillNodeLabels(["abc", "Valid label"])).toEqual({
      ok: true,
      labels: ["abc", "Valid label"],
    });
  });

  it("accepts a label at the exact maximum-length boundary (100 chars)", () => {
    const longLabel = "a".repeat(100);
    expect(validateSkillNodeLabels([longLabel, "Valid label"])).toEqual({
      ok: true,
      labels: [longLabel, "Valid label"],
    });
  });

  it("rejects a label one above the maximum-length boundary (101 chars)", () => {
    const tooLong = "a".repeat(101);
    expect(validateSkillNodeLabels([tooLong, "Valid label"])).toEqual({
      ok: false,
      error: "invalid_input",
    });
  });

  it("rejects a whitespace-only label", () => {
    expect(validateSkillNodeLabels(["   ", "Valid label"])).toEqual({
      ok: false,
      error: "invalid_input",
    });
  });

  it("rejects a non-string entry", () => {
    expect(validateSkillNodeLabels([42, "Valid label"])).toEqual({
      ok: false,
      error: "invalid_input",
    });
  });
});

describe("buildSkillNodes", () => {
  it("assigns deterministic node-<index> ids in submitted order", () => {
    expect(buildSkillNodes(["Fundamentals", "Evaluate", "Pilot"])).toEqual([
      { nodeId: "node-0", label: "Fundamentals", order: 0 },
      { nodeId: "node-1", label: "Evaluate", order: 1 },
      { nodeId: "node-2", label: "Pilot", order: 2 },
    ]);
  });

  it("produces order matching each array index exactly", () => {
    const nodes = buildSkillNodes(["A", "B"]);
    nodes.forEach((node, index) => {
      expect(node.order).toBe(index);
      expect(node.nodeId).toBe(`node-${index}`);
    });
  });

  it("is a known, exact fixture — node-id generation cannot silently change without this test detecting it", () => {
    expect(buildSkillNodes(["One", "Two", "Three", "Four"])).toEqual([
      { nodeId: "node-0", label: "One", order: 0 },
      { nodeId: "node-1", label: "Two", order: 1 },
      { nodeId: "node-2", label: "Three", order: 2 },
      { nodeId: "node-3", label: "Four", order: 3 },
    ]);
  });

  it("produces unique nodeIds across all nodes", () => {
    const nodes = buildSkillNodes(["A", "B", "C", "D", "E"]);
    const ids = nodes.map((node) => node.nodeId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

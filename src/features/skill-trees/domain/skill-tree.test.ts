import { describe, expect, it } from "vitest";
import { isValidSkillTree, type SkillNode } from "./skill-tree";

function makeNodes(count: number): SkillNode[] {
  return Array.from({ length: count }, (_, i) => ({
    nodeId: `node-${i}`,
    label: `Stage ${i}`,
    order: i,
  }));
}

describe("isValidSkillTree", () => {
  const valid = {
    name: "Container fundamentals",
    nodes: makeNodes(2),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    createdBy: "admin-uid-1",
  };

  it("accepts a well-formed candidate with neither updatedAt nor updatedBy (never corrected)", () => {
    expect(isValidSkillTree(valid)).toBe(true);
  });

  it("accepts a well-formed candidate with both updatedAt and updatedBy (corrected)", () => {
    const corrected = {
      ...valid,
      updatedAt: new Date("2026-06-02T00:00:00.000Z"),
      updatedBy: "admin-uid-2",
    };
    expect(isValidSkillTree(corrected)).toBe(true);
  });

  it("rejects a candidate with updatedAt set but updatedBy absent", () => {
    expect(
      isValidSkillTree({ ...valid, updatedAt: new Date("2026-06-02T00:00:00.000Z") }),
    ).toBe(false);
  });

  it("rejects a candidate with updatedBy set but updatedAt absent", () => {
    expect(isValidSkillTree({ ...valid, updatedBy: "admin-uid-2" })).toBe(false);
  });

  it("rejects a malformed updatedAt even when updatedBy is present", () => {
    expect(
      isValidSkillTree({ ...valid, updatedAt: "not a date", updatedBy: "admin-uid-2" }),
    ).toBe(false);
  });

  it("rejects a missing/blank/wrong-typed name", () => {
    expect(isValidSkillTree({ ...valid, name: undefined })).toBe(false);
    expect(isValidSkillTree({ ...valid, name: "" })).toBe(false);
    expect(isValidSkillTree({ ...valid, name: 42 })).toBe(false);
  });

  it("rejects a missing/blank createdBy", () => {
    expect(isValidSkillTree({ ...valid, createdBy: undefined })).toBe(false);
    expect(isValidSkillTree({ ...valid, createdBy: "" })).toBe(false);
  });

  it("rejects a missing or invalid createdAt", () => {
    const withoutCreatedAt: Record<string, unknown> = { ...valid };
    delete withoutCreatedAt.createdAt;
    expect(isValidSkillTree(withoutCreatedAt)).toBe(false);
    expect(isValidSkillTree({ ...valid, createdAt: "2026-06-01" })).toBe(false);
    expect(isValidSkillTree({ ...valid, createdAt: new Date("not a date") })).toBe(false);
  });

  it("accepts exactly 2 nodes (minimum boundary)", () => {
    expect(isValidSkillTree({ ...valid, nodes: makeNodes(2) })).toBe(true);
  });

  it("rejects exactly 1 node (below minimum)", () => {
    expect(isValidSkillTree({ ...valid, nodes: makeNodes(1) })).toBe(false);
  });

  it("accepts exactly 20 nodes (maximum boundary)", () => {
    expect(isValidSkillTree({ ...valid, nodes: makeNodes(20) })).toBe(true);
  });

  it("rejects exactly 21 nodes (above maximum)", () => {
    expect(isValidSkillTree({ ...valid, nodes: makeNodes(21) })).toBe(false);
  });

  it("rejects an empty nodes array", () => {
    expect(isValidSkillTree({ ...valid, nodes: [] })).toBe(false);
  });

  it("rejects a non-array nodes value", () => {
    expect(isValidSkillTree({ ...valid, nodes: "not an array" })).toBe(false);
  });

  it("rejects a nodes array whose nodeId doesn't match its array position", () => {
    const nodes = makeNodes(2);
    nodes[1] = { ...nodes[1], nodeId: "node-5" };
    expect(isValidSkillTree({ ...valid, nodes })).toBe(false);
  });

  it("rejects a nodes array whose order doesn't match its array position", () => {
    const nodes = makeNodes(2);
    nodes[1] = { ...nodes[1], order: 5 };
    expect(isValidSkillTree({ ...valid, nodes })).toBe(false);
  });

  it("rejects a nodes array containing a reordered pair (swapped nodeId/order)", () => {
    const nodes = makeNodes(3);
    const swapped = [nodes[1], nodes[0], nodes[2]];
    expect(isValidSkillTree({ ...valid, nodes: swapped })).toBe(false);
  });

  it("rejects a node with a missing/blank label", () => {
    const nodes = makeNodes(2);
    nodes[0] = { ...nodes[0], label: "" };
    expect(isValidSkillTree({ ...valid, nodes })).toBe(false);
  });

  it("rejects a malformed node entry (non-object)", () => {
    const nodes = [...makeNodes(2)] as unknown[];
    nodes[0] = "not an object";
    expect(isValidSkillTree({ ...valid, nodes })).toBe(false);
  });

  it("fails closed on non-object/malformed candidate data, never throwing", () => {
    expect(isValidSkillTree(null)).toBe(false);
    expect(isValidSkillTree(undefined)).toBe(false);
    expect(isValidSkillTree("not an object")).toBe(false);
    expect(isValidSkillTree(42)).toBe(false);
    expect(isValidSkillTree([])).toBe(false);
    expect(() => isValidSkillTree(Symbol("x"))).not.toThrow();
  });

  it("has no member/user identity requirement — a well-formed candidate carries no uid/email/displayName field", () => {
    const record = valid as Record<string, unknown>;
    expect("uid" in record).toBe(false);
    expect("email" in record).toBe(false);
    expect("displayName" in record).toBe(false);
    expect(isValidSkillTree(valid)).toBe(true);
  });

  it("tolerates an extra unexpected field without treating it as required or invalidating the record", () => {
    const withExtraField = { ...valid, unexpectedLegacyField: "unexpected-value" };
    expect(isValidSkillTree(withExtraField)).toBe(true);
  });
});

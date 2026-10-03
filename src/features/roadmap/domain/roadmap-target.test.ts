import { describe, expect, it } from "vitest";
import { isTargetReached, validateTargetNode } from "./roadmap-target";

function tree(count: number) {
  return {
    nodes: Array.from({ length: count }, (_, i) => ({ nodeId: `node-${i}`, label: `Stage ${i}`, order: i })),
  };
}

describe("validateTargetNode", () => {
  const t = tree(5);

  it("accepts a target strictly ahead of the current stage", () => {
    expect(validateTargetNode(t, "node-1", "node-2")).toEqual({ ok: true });
    expect(validateTargetNode(t, "node-0", "node-4")).toEqual({ ok: true });
  });

  it("accepts any node when the current stage is null (tracked, not started)", () => {
    expect(validateTargetNode(t, null, "node-0")).toEqual({ ok: true });
  });

  it("rejects a target equal to the current stage", () => {
    expect(validateTargetNode(t, "node-2", "node-2")).toEqual({ ok: false, error: "target_not_ahead" });
  });

  it("rejects a target behind the current stage", () => {
    expect(validateTargetNode(t, "node-3", "node-1")).toEqual({ ok: false, error: "target_not_ahead" });
  });

  it("rejects a well-formed id that belongs to a longer tree (cross-tree), stale and malformed targets", () => {
    for (const target of ["node-5", "node-19", "node-01", "NODE-1", "", " node-1", "node-1 ", null, undefined, 1, {}, ["node-1"]]) {
      expect(validateTargetNode(t, "node-0", target)).toEqual({ ok: false, error: "invalid_input" });
      expect(validateTargetNode(t, null, target)).toEqual({ ok: false, error: "invalid_input" });
    }
  });

  it("fails closed (not_tracked) when a non-null current stage is not a node of the tree", () => {
    expect(validateTargetNode(t, "node-9", "node-2")).toEqual({ ok: false, error: "not_tracked" });
    expect(validateTargetNode(t, "garbage", "node-2")).toEqual({ ok: false, error: "not_tracked" });
  });

  it("decides by tree order, not by id text (ids are not compared lexicographically)", () => {
    const big = tree(12);
    // "node-10" < "node-9" lexicographically, but stage 10 is ahead of stage 9.
    expect(validateTargetNode(big, "node-9", "node-10")).toEqual({ ok: true });
    expect(validateTargetNode(big, "node-10", "node-9")).toEqual({ ok: false, error: "target_not_ahead" });
  });

  it("uses the supplied node order even if ids do not encode it", () => {
    const odd = {
      nodes: [
        { nodeId: "b", label: "B", order: 0 },
        { nodeId: "a", label: "A", order: 1 },
      ],
    };
    expect(validateTargetNode(odd, "b", "a")).toEqual({ ok: true });
    expect(validateTargetNode(odd, "a", "b")).toEqual({ ok: false, error: "target_not_ahead" });
  });
});

describe("isTargetReached", () => {
  const t = tree(5);

  it("is true when current is at or past the target, false when behind", () => {
    expect(isTargetReached(t, "node-3", "node-3")).toBe(true);
    expect(isTargetReached(t, "node-4", "node-3")).toBe(true);
    expect(isTargetReached(t, "node-2", "node-3")).toBe(false);
  });

  it("is false for a tracked-but-not-started area", () => {
    expect(isTargetReached(t, null, "node-0")).toBe(false);
  });

  it("is not derivable (null) for a missing target or a current stage outside the tree", () => {
    expect(isTargetReached(t, "node-1", "node-9")).toBeNull();
    expect(isTargetReached(t, "node-9", "node-1")).toBeNull();
  });

  it("is only an indicator: it returns a boolean and has no way to set a status", () => {
    const reached = isTargetReached(t, "node-4", "node-3");
    expect(typeof reached).toBe("boolean");
  });
});

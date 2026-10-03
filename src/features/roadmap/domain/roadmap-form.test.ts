import { describe, expect, it } from "vitest";
import {
  KEEP_OWNER,
  buildCreateBody,
  buildPatchBody,
  datesInOrder,
  forwardTargetOptions,
  type ExistingPlanValues,
  type PlanFormValues,
} from "./roadmap-form";

const nodes = [
  { nodeId: "c", label: "C", order: 3 },
  { nodeId: "a", label: "A", order: 1 },
  { nodeId: "b", label: "B", order: 2 },
];

const existing: ExistingPlanValues = {
  targetNodeId: "b",
  priority: "medium",
  status: "planned",
  startDate: "2026-01-01",
  targetDate: null,
  owner: { memberRef: "ref-1" },
};
const same: PlanFormValues = {
  targetNodeId: "b",
  priority: "medium",
  status: "planned",
  startDate: "2026-01-01",
  targetDate: "",
  owner: "ref-1",
};

describe("forwardTargetOptions", () => {
  it("offers only stages strictly above the current one, ordered", () => {
    expect(forwardTargetOptions(nodes, "a")).toEqual([
      { nodeId: "b", label: "B" },
      { nodeId: "c", label: "C" },
    ]);
    expect(forwardTargetOptions(nodes, "c")).toEqual([]);
  });
  it("offers every stage when tracked below the first node (null)", () => {
    expect(forwardTargetOptions(nodes, null).map((o) => o.nodeId)).toEqual(["a", "b", "c"]);
  });
  it("offers nothing when the current stage is not a node of the tree", () => {
    expect(forwardTargetOptions(nodes, "zzz")).toEqual([]);
  });
});

describe("datesInOrder", () => {
  it("allows empty sides and equal dates, rejects start after target", () => {
    expect(datesInOrder("", "2026-01-01")).toBe(true);
    expect(datesInOrder("2026-01-01", "")).toBe(true);
    expect(datesInOrder("2026-01-01", "2026-01-01")).toBe(true);
    expect(datesInOrder("2026-02-01", "2026-01-01")).toBe(false);
  });
});

describe("buildCreateBody", () => {
  it("sends only approved fields and omits empty optionals", () => {
    expect(buildCreateBody("t1", { ...same, startDate: "", owner: "" })).toEqual({
      treeId: "t1",
      targetNodeId: "b",
      priority: "medium",
    });
  });
  it("includes dates and ownerRef when chosen", () => {
    expect(buildCreateBody("t1", { ...same, targetDate: "2026-05-01" })).toEqual({
      treeId: "t1",
      targetNodeId: "b",
      priority: "medium",
      startDate: "2026-01-01",
      targetDate: "2026-05-01",
      ownerRef: "ref-1",
    });
  });
});

describe("buildPatchBody", () => {
  it("returns null when nothing changed", () => {
    expect(buildPatchBody(existing, same)).toBeNull();
  });
  it("sends only changed fields", () => {
    expect(buildPatchBody(existing, { ...same, priority: "high", status: "active" })).toEqual({
      priority: "high",
      status: "active",
    });
  });
  it("sends a retarget only when the target differs", () => {
    expect(buildPatchBody(existing, { ...same, targetNodeId: "c" })).toEqual({ targetNodeId: "c" });
    expect(buildPatchBody({ ...existing, targetNodeId: "gone" }, { ...same, targetNodeId: "" })).toBeNull();
  });
  it("clears a date with null and sets a new one", () => {
    expect(buildPatchBody(existing, { ...same, startDate: "", targetDate: "2026-03-03" })).toEqual({
      startDate: null,
      targetDate: "2026-03-03",
    });
  });
  it("replaces and clears the owner; omits it when untouched", () => {
    expect(buildPatchBody(existing, { ...same, owner: "ref-2" })).toEqual({ ownerRef: "ref-2" });
    expect(buildPatchBody(existing, { ...same, owner: "" })).toEqual({ ownerRef: null });
    expect(buildPatchBody({ ...existing, owner: null }, { ...same, owner: "" })).toBeNull();
  });
  it("preserves an unavailable owner by omission until explicit action", () => {
    const e = { ...existing, owner: "unavailable" as const };
    expect(buildPatchBody(e, { ...same, owner: KEEP_OWNER })).toBeNull();
    expect(buildPatchBody(e, { ...same, owner: KEEP_OWNER, priority: "low" })).toEqual({ priority: "low" });
    expect(buildPatchBody(e, { ...same, owner: "" })).toEqual({ ownerRef: null });
    expect(buildPatchBody(e, { ...same, owner: "ref-9" })).toEqual({ ownerRef: "ref-9" });
  });
});

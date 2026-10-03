import { describe, expect, it } from "vitest";
import {
  applyStatusTransition,
  isRoadmapItemFor,
  parseRoadmapItem,
  roadmapItemDocId,
  ROADMAP_PRIORITIES,
  ROADMAP_STATUSES,
  type RoadmapItemRecord,
} from "./roadmap-item";

const T0 = new Date("2026-06-01T00:00:00.000Z");

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: "team-1",
    treeId: "tree-1",
    targetNodeId: "node-2",
    priority: "medium",
    status: "planned",
    createdAt: T0,
    createdBy: "uid-1",
    updatedAt: T0,
    updatedBy: "uid-1",
    ...overrides,
  };
}

function without(key: string): Record<string, unknown> {
  const copy = raw();
  delete copy[key];
  return copy;
}

describe("roadmapItemDocId / isRoadmapItemFor", () => {
  it("is deterministic and differs per team and per tree", () => {
    expect(roadmapItemDocId("team-1", "tree-1")).toBe("team-1__tree-1");
    expect(roadmapItemDocId("team-1", "tree-1")).toBe(roadmapItemDocId("team-1", "tree-1"));
    expect(roadmapItemDocId("team-2", "tree-1")).not.toBe(roadmapItemDocId("team-1", "tree-1"));
    expect(roadmapItemDocId("team-1", "tree-2")).not.toBe(roadmapItemDocId("team-1", "tree-1"));
  });

  it("accepts a document only when stored identity, route identity and doc id all agree", () => {
    const item = parseRoadmapItem(raw()) as RoadmapItemRecord;
    expect(isRoadmapItemFor(item, "team-1__tree-1", "team-1", "tree-1")).toBe(true);
  });

  it("fails closed when the doc id disagrees with the stored identity", () => {
    const item = parseRoadmapItem(raw()) as RoadmapItemRecord;
    expect(isRoadmapItemFor(item, "team-1__tree-9", "team-1", "tree-1")).toBe(false);
    expect(isRoadmapItemFor(item, "team-9__tree-1", "team-1", "tree-1")).toBe(false);
  });

  it("fails closed when a stored field disagrees with the route even if the doc id matches the route", () => {
    const otherTeam = parseRoadmapItem(raw({ teamId: "team-2" })) as RoadmapItemRecord;
    expect(isRoadmapItemFor(otherTeam, "team-1__tree-1", "team-1", "tree-1")).toBe(false);
    const otherTree = parseRoadmapItem(raw({ treeId: "tree-2" })) as RoadmapItemRecord;
    expect(isRoadmapItemFor(otherTree, "team-1__tree-1", "team-1", "tree-1")).toBe(false);
  });

  it("fails closed on the a__b + c / a + b__c composite-id collision", () => {
    const item = parseRoadmapItem(raw({ teamId: "a", treeId: "b__c" })) as RoadmapItemRecord;
    expect(roadmapItemDocId("a__b", "c")).toBe(roadmapItemDocId("a", "b__c"));
    expect(isRoadmapItemFor(item, roadmapItemDocId("a__b", "c"), "a__b", "c")).toBe(false);
  });

  it("never grants a match from the doc id alone (identity is the stored fields, not the id)", () => {
    const item = parseRoadmapItem(raw()) as RoadmapItemRecord;
    expect(isRoadmapItemFor(item, "team-2__tree-1", "team-2", "tree-1")).toBe(false);
    expect(isRoadmapItemFor(item, "__", "", "")).toBe(false);
  });
});

describe("parseRoadmapItem", () => {
  it("parses a minimal valid document and keeps identity as stored fields", () => {
    const item = parseRoadmapItem(raw());
    expect(item).toEqual(raw());
    expect(item?.teamId).toBe("team-1");
    expect(item?.treeId).toBe("tree-1");
  });

  it("accepts every priority and every status", () => {
    for (const priority of ROADMAP_PRIORITIES) {
      expect(parseRoadmapItem(raw({ priority }))?.priority).toBe(priority);
    }
    for (const status of ROADMAP_STATUSES) {
      const extra = status === "completed" ? { completedAt: T0 } : {};
      expect(parseRoadmapItem(raw({ status, ...extra }))?.status).toBe(status);
    }
  });

  it("rejects invalid or localised priority and status values", () => {
    for (const priority of ["Høy", "HIGH", "urgent", "", 1, null, undefined]) {
      expect(parseRoadmapItem(raw({ priority }))).toBeNull();
    }
    for (const status of ["archived", "paused", "cancelled", "Planned", "", 1, null, undefined]) {
      expect(parseRoadmapItem(raw({ status }))).toBeNull();
    }
  });

  it("rejects non-objects and missing/blank/wrong-typed identity and target", () => {
    for (const bad of [null, undefined, "x", 1, [], true]) {
      expect(parseRoadmapItem(bad)).toBeNull();
    }
    for (const key of ["teamId", "treeId", "targetNodeId", "createdBy", "updatedBy"]) {
      expect(parseRoadmapItem(without(key))).toBeNull();
      expect(parseRoadmapItem(raw({ [key]: "" }))).toBeNull();
      expect(parseRoadmapItem(raw({ [key]: 42 }))).toBeNull();
    }
    expect(parseRoadmapItem(raw({ targetNodeId: null }))).toBeNull();
  });

  it("rejects malformed timestamps", () => {
    for (const key of ["createdAt", "updatedAt"]) {
      expect(parseRoadmapItem(without(key))).toBeNull();
      expect(parseRoadmapItem(raw({ [key]: "2026-06-01" }))).toBeNull();
      expect(parseRoadmapItem(raw({ [key]: new Date("nope") }))).toBeNull();
    }
  });

  it("validates optional dates, including the start <= target ordering", () => {
    expect(parseRoadmapItem(raw({ startDate: "2026-06-01" }))?.startDate).toBe("2026-06-01");
    expect(parseRoadmapItem(raw({ targetDate: "2026-09-30" }))?.targetDate).toBe("2026-09-30");
    expect(parseRoadmapItem(raw({ startDate: "2026-06-01", targetDate: "2026-06-01" }))).not.toBeNull();
    expect(parseRoadmapItem(raw({ startDate: "2026-07-01", targetDate: "2026-06-01" }))).toBeNull();
    expect(parseRoadmapItem(raw({ startDate: "2026-02-30" }))).toBeNull();
    expect(parseRoadmapItem(raw({ targetDate: null }))).toBeNull();
    expect(parseRoadmapItem(raw({ targetDate: new Date(T0) }))).toBeNull();
  });

  it("keeps a string ownerRef as an opaque value and drops a non-string ownerRef (no owner)", () => {
    expect(parseRoadmapItem(raw({ ownerRef: "abc" }))?.ownerRef).toBe("abc");
    for (const ownerRef of [42, null, {}, ["x"], true]) {
      const item = parseRoadmapItem(raw({ ownerRef }));
      expect(item).not.toBeNull();
      expect(item).not.toHaveProperty("ownerRef");
    }
  });

  it("represents archive separately from status and requires archivedAt/archivedBy together", () => {
    const archived = parseRoadmapItem(raw({ status: "active", archivedAt: T0, archivedBy: "uid-2" }));
    expect(archived?.status).toBe("active");
    expect(archived?.archivedAt).toEqual(T0);
    expect(parseRoadmapItem(raw({ archivedAt: T0 }))).toBeNull();
    expect(parseRoadmapItem(raw({ archivedBy: "uid-2" }))).toBeNull();
    expect(parseRoadmapItem(raw({ archivedAt: "x", archivedBy: "uid-2" }))).toBeNull();
    expect(parseRoadmapItem(raw({ archivedAt: T0, archivedBy: "" }))).toBeNull();
    expect(parseRoadmapItem(raw({ status: "archived", archivedAt: T0, archivedBy: "uid-2" }))).toBeNull();
  });

  it("requires completedAt exactly when the status is completed", () => {
    expect(parseRoadmapItem(raw({ status: "completed" }))).toBeNull();
    expect(parseRoadmapItem(raw({ status: "completed", completedAt: T0 }))).not.toBeNull();
    expect(parseRoadmapItem(raw({ status: "active", completedAt: T0 }))).toBeNull();
    expect(parseRoadmapItem(raw({ status: "completed", completedAt: "x" }))).toBeNull();
  });

  it("copies only the approved fields — no current stage, person data or unknown keys", () => {
    const item = parseRoadmapItem(
      raw({ currentNodeId: "node-1", displayName: "Alex", email: "a@example.test", ownerUid: "u", label: "x", score: 9 }),
    );
    expect(Object.keys(item as object).sort()).toEqual(
      ["createdAt", "createdBy", "priority", "status", "targetNodeId", "teamId", "treeId", "updatedAt", "updatedBy"],
    );
  });

  it("is independent of tracking: it takes no skill progress input at all", () => {
    expect(parseRoadmapItem.length).toBe(1);
  });
});

describe("applyStatusTransition", () => {
  const now = new Date("2026-07-01T00:00:00.000Z");

  it("sets completedAt when entering completed", () => {
    expect(applyStatusTransition({ status: "active" }, "completed", now)).toEqual({ status: "completed", completedAt: now });
  });

  it("keeps the existing completedAt while staying completed", () => {
    expect(applyStatusTransition({ status: "completed", completedAt: T0 }, "completed", now).completedAt).toEqual(T0);
  });

  it("removes completedAt when leaving completed (reopen)", () => {
    expect(applyStatusTransition({ status: "completed", completedAt: T0 }, "planned", now)).toEqual({ status: "planned", completedAt: null });
  });

  it("allows every transition among planned, active and completed", () => {
    for (const from of ROADMAP_STATUSES) {
      for (const to of ROADMAP_STATUSES) {
        expect(applyStatusTransition({ status: from, completedAt: from === "completed" ? T0 : undefined }, to, now).status).toBe(to);
      }
    }
  });
});

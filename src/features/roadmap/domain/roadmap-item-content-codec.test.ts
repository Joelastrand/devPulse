import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectStorageBoundary } from "../../../lib/encryption/storage-boundary-assertions";
import { detachedRoadmapItem, openRoadmapItemDocument, roadmapOwnerIndex, toPersistedRoadmapItem } from "./roadmap-item-content-codec";

/**
 * Storage boundary of a roadmap plan. The target stage, priority, status, plan dates, completion and owner are sealed; the
 * owner is found by a keyed index. Synthetic fixtures only.
 */
const TEAM = "team-road-1";
const TREE = "tree-road-1";
const record = {
  teamId: TEAM,
  treeId: TREE,
  targetNodeId: "synthetic-target-node",
  priority: "high",
  status: "active",
  startDate: "2026-02-01",
  targetDate: "2026-06-30",
  ownerRef: "synthetic-owner-ref",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  createdBy: "admin-1",
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  updatedBy: "admin-1",
};

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

describe("roadmap plan storage boundary", () => {
  it("persists no plaintext target, priority, status, date or owner, refuses tampering, substitution and a missing key", () => {
    const persisted = toPersistedRoadmapItem(record);
    expectStorageBoundary({
      persisted,
      secrets: ["synthetic-target-node", "synthetic-owner-ref", "2026-06-30", "2026-02-01"],
      envelopeField: "content",
      open: (p) => openRoadmapItemDocument(p),
      openAsOtherRecord: (p) => openRoadmapItemDocument({ ...p, treeId: "tree-other" }),
      openWithoutKey: (p) => {
        vi.stubEnv("ENCRYPTION_KEY", "");
        return openRoadmapItemDocument(p);
      },
    });
  });

  it("stores the owner only as a team-scoped keyed index", () => {
    const persisted = toPersistedRoadmapItem(record);
    expect(persisted).not.toHaveProperty("ownerRef");
    expect(persisted.ownerRefIndex).toBe(roadmapOwnerIndex(TEAM, "synthetic-owner-ref"));
    expect(roadmapOwnerIndex("team-other", "synthetic-owner-ref")).not.toBe(persisted.ownerRefIndex);
  });

  it("keeps identifiers, lifecycle timestamps and audit uids plaintext", () => {
    const persisted = toPersistedRoadmapItem(record);
    expect(persisted).toMatchObject({ teamId: TEAM, treeId: TREE, createdBy: "admin-1", updatedBy: "admin-1" });
    expect(persisted).not.toHaveProperty("status");
    expect(persisted).not.toHaveProperty("priority");
  });

  it("restores the plan, including the completion date, for the owning plan", () => {
    const completed = { ...record, status: "completed", completedAt: new Date("2026-03-01T00:00:00Z") };
    expect(openRoadmapItemDocument(toPersistedRoadmapItem(completed))).toMatchObject({
      targetNodeId: "synthetic-target-node",
      status: "completed",
      ownerRef: "synthetic-owner-ref",
      completedAt: new Date("2026-03-01T00:00:00Z"),
    });
  });

  it("detaches the owner by re-sealing the whole plan without it, and only for that owner", () => {
    const persisted = toPersistedRoadmapItem(record);
    const detached = detachedRoadmapItem(persisted, "synthetic-owner-ref");
    expect(detached).not.toBeNull();
    expect(detached).not.toHaveProperty("ownerRefIndex");
    expect(openRoadmapItemDocument(detached)).toMatchObject({ targetNodeId: "synthetic-target-node", status: "active" });
    expect(openRoadmapItemDocument(detached)).not.toHaveProperty("ownerRef");
    expect(detachedRoadmapItem(persisted, "someone-else")).toBeNull();
  });

  it("refuses an owner index that does not match the sealed owner", () => {
    const persisted = toPersistedRoadmapItem(record);
    expect(openRoadmapItemDocument({ ...persisted, ownerRefIndex: roadmapOwnerIndex(TEAM, "someone-else") })).toBeNull();
  });
});

import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectStorageBoundary } from "../../../lib/encryption/storage-boundary-assertions";
import { openSkillTreeDocument, toPersistedSkillTree } from "./skill-tree-content-codec";

/** Storage boundary of a skill tree: the name and labels are sealed; identifiers, order and audit fields stay plaintext. */
const TREE = "tree-storage-1";
const OTHER_TREE = "tree-storage-2";
const record = {
  name: "Synthetic tree name",
  nodes: [
    { nodeId: "node-0", label: "Synthetic label alpha", order: 0 },
    { nodeId: "node-1", label: "Synthetic label beta", order: 1 },
  ],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  createdBy: "admin-1",
};

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

describe("skill tree storage boundary", () => {
  it("persists no plaintext name or label, refuses tampering, substitution and a missing key", () => {
    const persisted = toPersistedSkillTree(TREE, record);
    expectStorageBoundary({
      persisted,
      secrets: ["Synthetic tree name", "Synthetic label alpha", "Synthetic label beta"],
      envelopeField: "content",
      open: (p) => openSkillTreeDocument(TREE, p),
      openAsOtherRecord: (p) => openSkillTreeDocument(OTHER_TREE, p),
      openWithoutKey: (p) => {
        vi.stubEnv("ENCRYPTION_KEY", "");
        return openSkillTreeDocument(TREE, p);
      },
    });
  });

  it("keeps the tree and node identifiers, the order and the audit fields plaintext", () => {
    const persisted = toPersistedSkillTree(TREE, record);
    expect(persisted.nodes).toEqual([
      { nodeId: "node-0", order: 0 },
      { nodeId: "node-1", order: 1 },
    ]);
    expect(persisted).toMatchObject({ createdBy: "admin-1" });
    expect(persisted).not.toHaveProperty("name");
  });

  it("restores the authored name and labels for the owning tree", () => {
    expect(openSkillTreeDocument(TREE, toPersistedSkillTree(TREE, record))).toMatchObject({
      name: "Synthetic tree name",
      nodes: [
        { nodeId: "node-0", label: "Synthetic label alpha", order: 0 },
        { nodeId: "node-1", label: "Synthetic label beta", order: 1 },
      ],
    });
  });

  it("refuses a document that still carries a plaintext label next to the envelope", () => {
    const persisted = toPersistedSkillTree(TREE, record);
    const leaked = { ...persisted, nodes: [{ nodeId: "node-0", label: "Synthetic label alpha", order: 0 }, { nodeId: "node-1", order: 1 }] };
    expect(openSkillTreeDocument(TREE, leaked)).toBeNull();
  });
});

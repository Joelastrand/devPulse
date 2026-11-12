import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectStorageBoundary } from "../../../lib/encryption/storage-boundary-assertions";
import { openSkillProgressDocument, toPersistedSkillProgress } from "./skill-progress-content-codec";

/** Storage boundary of a team's tracked stage: the stage is sealed; team, tree and audit fields stay plaintext. */
const TEAM = "team-prog-1";
const TREE = "tree-prog-1";
const OTHER_TREE = "tree-prog-2";
const record = {
  teamId: TEAM,
  treeId: TREE,
  currentNodeId: "synthetic-stage-node",
  updatedAt: new Date("2026-01-03T00:00:00Z"),
  updatedBy: "member-1",
};

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

describe("skill progress storage boundary", () => {
  it("persists no plaintext stage, refuses tampering, substitution and a missing key", () => {
    const persisted = toPersistedSkillProgress(record);
    expectStorageBoundary({
      persisted,
      secrets: ["synthetic-stage-node"],
      envelopeField: "content",
      open: (p) => openSkillProgressDocument(p),
      openAsOtherRecord: (p) => openSkillProgressDocument({ ...p, treeId: OTHER_TREE }),
      openWithoutKey: (p) => {
        vi.stubEnv("ENCRYPTION_KEY", "");
        return openSkillProgressDocument(p);
      },
    });
  });

  it("keeps the team, tree and audit fields plaintext", () => {
    const persisted = toPersistedSkillProgress(record);
    expect(persisted).toMatchObject({ teamId: TEAM, treeId: TREE, updatedBy: "member-1" });
    expect(persisted).not.toHaveProperty("currentNodeId");
  });

  it("restores a stage, including a null stage of a freshly tracked tree", () => {
    expect(openSkillProgressDocument(toPersistedSkillProgress(record))).toMatchObject({ currentNodeId: "synthetic-stage-node" });
    expect(openSkillProgressDocument(toPersistedSkillProgress({ ...record, currentNodeId: null }))).toMatchObject({ currentNodeId: null });
  });

  it("refuses a document that still carries a plaintext stage", () => {
    expect(openSkillProgressDocument({ ...toPersistedSkillProgress(record), currentNodeId: "synthetic-stage-node" })).toBeNull();
  });
});

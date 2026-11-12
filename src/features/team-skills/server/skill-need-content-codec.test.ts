import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectStorageBoundary } from "../../../lib/encryption/storage-boundary-assertions";
import { openSkillNeedDocument, toPersistedSkillNeed } from "./skill-need-content-codec";

/**
 * Storage boundary of a team's skill requirement. The required level and coverage are sealed; the team and area keys and the
 * timestamps stay plaintext. The sealed values are numeric, so the check uses their field names as the secrets.
 */
const TEAM = "team-need-1";
const TREE = "tree-need-1";
const OTHER_TREE = "tree-need-2";
const record = {
  teamId: TEAM,
  treeId: TREE,
  requiredLevel: 3 as const,
  requiredCoverage: 7,
  createdAt: new Date("2026-01-04T00:00:00Z"),
  updatedAt: new Date("2026-01-04T00:00:00Z"),
};

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

describe("team skill need storage boundary", () => {
  it("persists neither the required level nor the coverage, refuses tampering, substitution and a missing key", () => {
    const persisted = toPersistedSkillNeed(record);
    expectStorageBoundary({
      persisted,
      secrets: ["requiredLevel", "requiredCoverage"],
      envelopeField: "content",
      open: (p) => openSkillNeedDocument(p),
      openAsOtherRecord: (p) => openSkillNeedDocument({ ...p, treeId: OTHER_TREE }),
      openWithoutKey: (p) => {
        vi.stubEnv("ENCRYPTION_KEY", "");
        return openSkillNeedDocument(p);
      },
    });
  });

  it("keeps the team and area keys and the timestamps plaintext", () => {
    const persisted = toPersistedSkillNeed(record);
    expect(persisted).toMatchObject({ teamId: TEAM, treeId: TREE, createdAt: record.createdAt });
  });

  it("restores the requirement for the owning team and area", () => {
    expect(openSkillNeedDocument(toPersistedSkillNeed(record))).toMatchObject({ requiredLevel: 3, requiredCoverage: 7 });
  });
});

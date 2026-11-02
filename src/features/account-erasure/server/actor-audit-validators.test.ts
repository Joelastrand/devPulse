import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isValidChallenge } from "../../challenges/domain/challenge";
import { parseStoredRoleDefinition } from "../../role-profiles/domain/role-definition";
import { isValidSkillTree, type SkillNode } from "../../skill-trees/domain/skill-tree";
import { isValidSurvey } from "../../surveys/domain/survey";

// TASK-023: the readers and validators accept exactly `null` for an erased actor field (SPEC A-1, A-2, A-3, A-7), and still
// reject every other malformed value. Fixtures are synthetic. The parsers are the production validators.

const T0 = new Date("2026-06-01T00:00:00.000Z");
const T1 = new Date("2026-06-02T00:00:00.000Z");
const T2 = new Date("2026-06-03T00:00:00.000Z");
const MALFORMED_ACTORS: unknown[] = [undefined, "", 42, {}, false];

// Two nodes: the minimum a skill tree may hold (SKILL_TREE_MIN_NODES).
const nodes: SkillNode[] = [
  { nodeId: "node-0", label: "Stage 0", order: 0 },
  { nodeId: "node-1", label: "Stage 1", order: 1 },
];

describe("survey createdBy (A-1)", () => {
  const survey = { surveyId: "s1", teamId: "t1", accessMode: "public", minimumResponses: 5, createdAt: T0 };

  it("accepts an erased creator (null) and a normal creator", () => {
    expect(isValidSurvey({ ...survey, createdBy: null }, { surveyId: "s1" })).toBe(true);
    expect(isValidSurvey({ ...survey, createdBy: "admin-1" }, { surveyId: "s1" })).toBe(true);
  });

  it.each(MALFORMED_ACTORS)("rejects a malformed creator value (%s)", (createdBy) => {
    expect(isValidSurvey({ ...survey, createdBy }, { surveyId: "s1" })).toBe(false);
  });
});

describe("skill tree createdBy and updatedBy (A-2)", () => {
  const tree = { name: "Tree", nodes, createdAt: T0 };

  it("accepts a null creator and a null updater alongside a timestamp", () => {
    expect(isValidSkillTree({ ...tree, createdBy: null })).toBe(true);
    expect(isValidSkillTree({ ...tree, createdBy: "admin-1", updatedAt: T1, updatedBy: null })).toBe(true);
  });

  it("still rejects a malformed updater and an updater without its timestamp", () => {
    expect(isValidSkillTree({ ...tree, createdBy: "admin-1", updatedAt: T1, updatedBy: "" })).toBe(false);
    expect(isValidSkillTree({ ...tree, createdBy: "admin-1", updatedBy: null })).toBe(false);
  });

  it.each(MALFORMED_ACTORS)("rejects a malformed creator value (%s)", (createdBy) => {
    expect(isValidSkillTree({ ...tree, createdBy })).toBe(false);
  });
});

describe("role definition createdBy, updatedBy and archivedBy (A-3)", () => {
  const stored = { name: "Backend engineer", expectations: [{ treeId: "api", expectedLevel: 3 }], createdAt: T0 };

  it("accepts null for each actor field on a stored role", () => {
    const result = parseStoredRoleDefinition({
      ...stored,
      createdBy: null,
      updatedAt: T1,
      updatedBy: null,
      archivedAt: T2,
      archivedBy: null,
    });
    expect(result.ok).toBe(true);
  });

  it.each(MALFORMED_ACTORS)("rejects a malformed creator value (%s)", (createdBy) => {
    expect(parseStoredRoleDefinition({ ...stored, createdBy }).ok).toBe(false);
  });

  it("rejects a malformed archiver value, even when the rest of the record is valid", () => {
    expect(parseStoredRoleDefinition({ ...stored, createdBy: "admin-1", archivedAt: T2, archivedBy: "" }).ok).toBe(false);
  });
});

describe("challenge resolvedBy and archivedBy (A-7)", () => {
  const challenge = {
    challengeId: "c1",
    teamId: "t1",
    ciphertext: "ciphertext-base64",
    iv: "iv-base64",
    authTag: "auth-tag-base64",
    keyVersion: "v1",
    submittedAt: T0,
  };

  it("accepts a null actor alongside its timestamp, and keeps the anonymous content", () => {
    expect(isValidChallenge({ ...challenge, resolvedAt: T1, resolvedBy: null }, { challengeId: "c1" })).toBe(true);
    expect(isValidChallenge({ ...challenge, archivedAt: T2, archivedBy: null }, { challengeId: "c1" })).toBe(true);
  });

  it("still rejects a malformed actor, and an actor without its timestamp", () => {
    expect(isValidChallenge({ ...challenge, resolvedAt: T1, resolvedBy: "" }, { challengeId: "c1" })).toBe(false);
    expect(isValidChallenge({ ...challenge, resolvedBy: null }, { challengeId: "c1" })).toBe(false);
  });
});

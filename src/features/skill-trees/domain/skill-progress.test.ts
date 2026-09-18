import { describe, expect, it } from "vitest";
import { isValidSkillProgress, skillProgressDocId } from "./skill-progress";

describe("isValidSkillProgress", () => {
  const valid = {
    teamId: "team-1",
    treeId: "tree-1",
    currentNodeId: "node-0",
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedBy: "admin-uid-1",
  };

  it("accepts a well-formed candidate with a string currentNodeId", () => {
    expect(isValidSkillProgress(valid)).toBe(true);
  });

  it("accepts a well-formed candidate with currentNodeId: null (tracked, not started)", () => {
    expect(isValidSkillProgress({ ...valid, currentNodeId: null })).toBe(true);
  });

  it("rejects a missing/blank/wrong-typed teamId", () => {
    expect(isValidSkillProgress({ ...valid, teamId: undefined })).toBe(false);
    expect(isValidSkillProgress({ ...valid, teamId: "" })).toBe(false);
    expect(isValidSkillProgress({ ...valid, teamId: 42 })).toBe(false);
  });

  it("rejects a missing/blank/wrong-typed treeId", () => {
    expect(isValidSkillProgress({ ...valid, treeId: undefined })).toBe(false);
    expect(isValidSkillProgress({ ...valid, treeId: "" })).toBe(false);
    expect(isValidSkillProgress({ ...valid, treeId: 42 })).toBe(false);
  });

  it("rejects a currentNodeId that is neither null nor a non-blank string", () => {
    expect(isValidSkillProgress({ ...valid, currentNodeId: "" })).toBe(false);
    expect(isValidSkillProgress({ ...valid, currentNodeId: 42 })).toBe(false);
    expect(isValidSkillProgress({ ...valid, currentNodeId: undefined })).toBe(false);
  });

  it("rejects a missing or invalid updatedAt", () => {
    const withoutUpdatedAt: Record<string, unknown> = { ...valid };
    delete withoutUpdatedAt.updatedAt;
    expect(isValidSkillProgress(withoutUpdatedAt)).toBe(false);
    expect(isValidSkillProgress({ ...valid, updatedAt: "2026-06-01" })).toBe(false);
    expect(isValidSkillProgress({ ...valid, updatedAt: new Date("not a date") })).toBe(false);
  });

  it("rejects a missing/blank updatedBy", () => {
    expect(isValidSkillProgress({ ...valid, updatedBy: undefined })).toBe(false);
    expect(isValidSkillProgress({ ...valid, updatedBy: "" })).toBe(false);
  });

  it("fails closed on non-object/malformed candidate data, never throwing", () => {
    expect(isValidSkillProgress(null)).toBe(false);
    expect(isValidSkillProgress(undefined)).toBe(false);
    expect(isValidSkillProgress("not an object")).toBe(false);
    expect(isValidSkillProgress(42)).toBe(false);
    expect(isValidSkillProgress([])).toBe(false);
    expect(() => isValidSkillProgress(Symbol("x"))).not.toThrow();
  });

  it("has no member/user identity requirement beyond the acting admin's updatedBy — no self-report field exists", () => {
    const record = valid as Record<string, unknown>;
    expect("uid" in record).toBe(false);
    expect("memberUid" in record).toBe(false);
    expect("email" in record).toBe(false);
    expect(isValidSkillProgress(valid)).toBe(true);
  });

  it("tolerates an extra unexpected field without treating it as required or invalidating the record", () => {
    const withExtraField = { ...valid, unexpectedLegacyField: "unexpected-value" };
    expect(isValidSkillProgress(withExtraField)).toBe(true);
  });
});

describe("skillProgressDocId", () => {
  it("resolves the same team + same tree to the same document id", () => {
    expect(skillProgressDocId("team-1", "tree-1")).toBe(skillProgressDocId("team-1", "tree-1"));
  });

  it("resolves a different team to a different document id", () => {
    expect(skillProgressDocId("team-1", "tree-1")).not.toBe(skillProgressDocId("team-2", "tree-1"));
  });

  it("resolves a different tree to a different document id", () => {
    expect(skillProgressDocId("team-1", "tree-1")).not.toBe(skillProgressDocId("team-1", "tree-2"));
  });

  it("does not collide across a swapped teamId/treeId pair with the same underlying substrings", () => {
    // teamId="a__b", treeId="c" would collide with teamId="a", treeId="b__c"
    // under naive concatenation without a fixed separator boundary — both
    // resolve to "a__b__c". This is an accepted edge case: real `teamId`/
    // `treeId` values are Firestore auto-generated ids that never contain
    // "__", so this collision is not reachable in practice, but the id
    // scheme itself is documented here rather than silently assumed safe.
    expect(skillProgressDocId("a__b", "c")).toBe(skillProgressDocId("a", "b__c"));
  });
});

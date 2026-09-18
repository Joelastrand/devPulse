import { describe, expect, it } from "vitest";
import { isForumReplyDeleted, isValidForumReply } from "./forum-reply";

describe("isValidForumReply", () => {
  const activeValid = {
    teamId: "team-1",
    threadId: "thread-1",
    authorUid: "uid-1",
    ciphertext: "ciphertext-base64",
    iv: "iv-base64",
    authTag: "auth-tag-base64",
    keyVersion: "v1",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
  };

  const tombstoneValid = {
    teamId: "team-1",
    threadId: "thread-1",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    deletedAt: new Date("2026-06-02T00:00:00.000Z"),
    deletedBy: "admin-uid-1",
  };

  it("accepts a well-formed active shape", () => {
    expect(isValidForumReply(activeValid)).toBe(true);
  });

  it("accepts a well-formed tombstone shape", () => {
    expect(isValidForumReply(tombstoneValid)).toBe(true);
  });

  it("rejects an active candidate with a missing/blank/wrong-typed teamId, threadId, or authorUid", () => {
    expect(isValidForumReply({ ...activeValid, teamId: "" })).toBe(false);
    expect(isValidForumReply({ ...activeValid, threadId: undefined })).toBe(false);
    expect(isValidForumReply({ ...activeValid, authorUid: 42 })).toBe(false);
  });

  it("rejects an active candidate with a missing/blank ciphertext, iv, or authTag", () => {
    expect(isValidForumReply({ ...activeValid, ciphertext: "" })).toBe(false);
    expect(isValidForumReply({ ...activeValid, iv: undefined })).toBe(false);
    expect(isValidForumReply({ ...activeValid, authTag: 123 })).toBe(false);
  });

  it("rejects an active candidate with a syntactically-valid-but-wrong keyVersion, not just any string", () => {
    expect(isValidForumReply({ ...activeValid, keyVersion: "v2" })).toBe(false);
    expect(isValidForumReply({ ...activeValid, keyVersion: "" })).toBe(false);
  });

  it("rejects an active candidate with a missing or invalid createdAt", () => {
    const withoutCreatedAt: Record<string, unknown> = { ...activeValid };
    delete withoutCreatedAt.createdAt;
    expect(isValidForumReply(withoutCreatedAt)).toBe(false);
    expect(isValidForumReply({ ...activeValid, createdAt: "2026-06-01T00:00:00.000Z" })).toBe(
      false,
    );
  });

  it("rejects a tombstone candidate with a missing/blank teamId or threadId", () => {
    expect(isValidForumReply({ ...tombstoneValid, teamId: "" })).toBe(false);
    expect(isValidForumReply({ ...tombstoneValid, threadId: undefined })).toBe(false);
  });

  it("rejects a tombstone candidate with a missing/invalid createdAt, deletedAt, or deletedBy", () => {
    const withoutCreatedAt: Record<string, unknown> = { ...tombstoneValid };
    delete withoutCreatedAt.createdAt;
    expect(isValidForumReply(withoutCreatedAt)).toBe(false);
    expect(isValidForumReply({ ...tombstoneValid, deletedAt: "not a date" })).toBe(false);
    expect(isValidForumReply({ ...tombstoneValid, deletedBy: "" })).toBe(false);
  });

  it("rejects a candidate carrying fields from both shapes (deletedAt set, ciphertext still present) — BR-56", () => {
    expect(
      isValidForumReply({
        ...activeValid,
        deletedAt: new Date("2026-06-02T00:00:00.000Z"),
        deletedBy: "admin-uid-1",
      }),
    ).toBe(false);
  });

  it("rejects a candidate carrying only some active fields alongside a full tombstone shape", () => {
    expect(isValidForumReply({ ...tombstoneValid, ciphertext: "leftover-ciphertext" })).toBe(
      false,
    );
    expect(isValidForumReply({ ...tombstoneValid, authorUid: "uid-1" })).toBe(false);
  });

  it("rejects a candidate with fields from neither shape (missing both ciphertext and deletedAt)", () => {
    expect(
      isValidForumReply({
        teamId: "team-1",
        threadId: "thread-1",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("fails closed on non-object/malformed candidate data, never throwing", () => {
    expect(isValidForumReply(null)).toBe(false);
    expect(isValidForumReply(undefined)).toBe(false);
    expect(isValidForumReply("not an object")).toBe(false);
    expect(isValidForumReply(42)).toBe(false);
    expect(isValidForumReply([])).toBe(false);
    expect(() => isValidForumReply(Symbol("x"))).not.toThrow();
  });

  it("has no identity requirement on a tombstone beyond deletedBy — no authorUid/email/displayName field required or expected", () => {
    const record = tombstoneValid as Record<string, unknown>;
    expect("authorUid" in record).toBe(false);
    expect("email" in record).toBe(false);
    expect("displayName" in record).toBe(false);
    expect(isValidForumReply(tombstoneValid)).toBe(true);
  });

  it("tolerates an extra identity-shaped field unrelated to either shape without affecting acceptance", () => {
    expect(isValidForumReply({ ...activeValid, email: "someone@example.com" })).toBe(true);
    expect(isValidForumReply({ ...tombstoneValid, displayName: "Someone" })).toBe(true);
  });
});

describe("isForumReplyDeleted", () => {
  const activeValid = {
    teamId: "team-1",
    threadId: "thread-1",
    authorUid: "uid-1",
    ciphertext: "ciphertext-base64",
    iv: "iv-base64",
    authTag: "auth-tag-base64",
    keyVersion: "v1" as const,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
  };

  const tombstoneValid = {
    teamId: "team-1",
    threadId: "thread-1",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    deletedAt: new Date("2026-06-02T00:00:00.000Z"),
    deletedBy: "admin-uid-1",
  };

  it("is false for a well-formed active shape", () => {
    expect(isForumReplyDeleted(activeValid)).toBe(false);
  });

  it("is true for a well-formed tombstone shape", () => {
    expect(isForumReplyDeleted(tombstoneValid)).toBe(true);
  });
});

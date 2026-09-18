import { describe, expect, it } from "vitest";
import { isValidForumThread } from "./forum-thread";

describe("isValidForumThread", () => {
  const valid = {
    teamId: "team-1",
    authorUid: "uid-1",
    ciphertext: "ciphertext-base64",
    iv: "iv-base64",
    authTag: "auth-tag-base64",
    keyVersion: "v1",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
  };

  it("accepts a well-formed candidate", () => {
    expect(isValidForumThread(valid)).toBe(true);
  });

  it("rejects a missing/blank/wrong-typed teamId", () => {
    expect(isValidForumThread({ ...valid, teamId: undefined })).toBe(false);
    expect(isValidForumThread({ ...valid, teamId: "" })).toBe(false);
    expect(isValidForumThread({ ...valid, teamId: 42 })).toBe(false);
  });

  it("rejects a missing/blank/wrong-typed authorUid", () => {
    expect(isValidForumThread({ ...valid, authorUid: undefined })).toBe(false);
    expect(isValidForumThread({ ...valid, authorUid: "" })).toBe(false);
    expect(isValidForumThread({ ...valid, authorUid: 42 })).toBe(false);
  });

  it("rejects a missing/blank ciphertext, iv, or authTag", () => {
    expect(isValidForumThread({ ...valid, ciphertext: "" })).toBe(false);
    expect(isValidForumThread({ ...valid, iv: undefined })).toBe(false);
    expect(isValidForumThread({ ...valid, authTag: 123 })).toBe(false);
  });

  it("rejects a syntactically-valid-but-wrong keyVersion, not just any string", () => {
    expect(isValidForumThread({ ...valid, keyVersion: "v2" })).toBe(false);
    expect(isValidForumThread({ ...valid, keyVersion: "" })).toBe(false);
    expect(isValidForumThread({ ...valid, keyVersion: undefined })).toBe(false);
  });

  it("rejects a missing or invalid createdAt", () => {
    const withoutCreatedAt: Record<string, unknown> = { ...valid };
    delete withoutCreatedAt.createdAt;
    expect(isValidForumThread(withoutCreatedAt)).toBe(false);
    expect(isValidForumThread({ ...valid, createdAt: "2026-06-01T00:00:00.000Z" })).toBe(
      false,
    );
    expect(isValidForumThread({ ...valid, createdAt: new Date("not a date") })).toBe(false);
  });

  it("rejects a candidate carrying a deletedAt field — a thread has no tombstone shape", () => {
    expect(isValidForumThread({ ...valid, deletedAt: new Date("2026-06-02T00:00:00.000Z") })).toBe(
      false,
    );
  });

  it("rejects a candidate carrying a deletedBy field — a thread has no tombstone shape", () => {
    expect(isValidForumThread({ ...valid, deletedBy: "admin-uid-1" })).toBe(false);
  });

  it("rejects a candidate carrying both deletedAt and deletedBy, even though every other field is well-formed", () => {
    expect(
      isValidForumThread({
        ...valid,
        deletedAt: new Date("2026-06-02T00:00:00.000Z"),
        deletedBy: "admin-uid-1",
      }),
    ).toBe(false);
  });

  it("fails closed on non-object/malformed candidate data, never throwing", () => {
    expect(isValidForumThread(null)).toBe(false);
    expect(isValidForumThread(undefined)).toBe(false);
    expect(isValidForumThread("not an object")).toBe(false);
    expect(isValidForumThread(42)).toBe(false);
    expect(isValidForumThread([])).toBe(false);
    expect(() => isValidForumThread(Symbol("x"))).not.toThrow();
  });

  it("has no identity requirement beyond authorUid — a well-formed candidate has no email/displayName field", () => {
    const record = valid as Record<string, unknown>;
    expect("email" in record).toBe(false);
    expect("displayName" in record).toBe(false);
    expect(isValidForumThread(valid)).toBe(true);
  });

  it("tolerates an extra non-tombstone-shaped field without treating it as required or invalidating the record", () => {
    const withExtraField = { ...valid, email: "someone@example.com" };
    expect(isValidForumThread(withExtraField)).toBe(true);
  });
});

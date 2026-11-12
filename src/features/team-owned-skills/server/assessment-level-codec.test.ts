import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptRecord } from "../../../lib/encryption/record-envelope";
import { openAssessmentDocument, sealAssessmentLevel } from "./assessment-level-codec";

const base = { uid: "uid-1", teamId: "team-1", skillId: "skill-1", criteriaVersion: 2 };

function storedRating(level: unknown, overrides: Record<string, unknown> = {}) {
  return { ...base, level, createdAt: new Date(0), updatedAt: new Date(0), ...overrides };
}

describe("assessment level codec (private team-skill ratings)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("seals the rating as a v2 envelope that does not expose the level", () => {
    const sealed = sealAssessmentLevel(base.uid, base.teamId, base.skillId, 4);
    expect(sealed.keyVersion).toBe("v2");
    expect(Buffer.from(sealed.ciphertext, "base64").toString("utf8")).not.toBe('{"level":4}');
    expect(JSON.stringify(sealed)).not.toContain("level");
  });

  it("opens a sealed rating for the same person, team and skill", () => {
    const opened = openAssessmentDocument(base.uid, base.teamId, base.skillId, storedRating(sealAssessmentLevel(base.uid, base.teamId, base.skillId, 3)));
    expect(opened).toMatchObject({ level: 3, criteriaVersion: 2, teamId: "team-1" });
  });

  it.each([
    ["another person", { uid: "uid-2" }],
    ["another team", { teamId: "team-2" }],
    ["another skill", { skillId: "skill-2" }],
  ])("refuses a rating moved to %s (cross-record substitution)", (_label, target) => {
    const sealed = sealAssessmentLevel(base.uid, base.teamId, base.skillId, 3);
    const context = { ...base, ...target };
    const opened = openAssessmentDocument(context.uid, context.teamId, context.skillId, storedRating(sealed));
    expect((opened as { level: unknown }).level).toBeNull();
  });

  it("replaces a tampered envelope with null so the domain marks it unreadable", () => {
    const sealed = sealAssessmentLevel(base.uid, base.teamId, base.skillId, 2);
    const bytes = Buffer.from(sealed.authTag, "base64");
    bytes[0] ^= 0x01;
    const tampered = { ...sealed, authTag: bytes.toString("base64") };
    const opened = openAssessmentDocument(base.uid, base.teamId, base.skillId, storedRating(tampered));
    expect((opened as { level: unknown }).level).toBeNull();
  });

  it("never accepts a plaintext level (no plaintext fallback)", () => {
    const opened = openAssessmentDocument(base.uid, base.teamId, base.skillId, storedRating(3));
    expect((opened as { level: unknown }).level).toBeNull();
  });

  it("refuses an envelope whose decrypted payload is not a valid level", () => {
    const notALevel = encryptRecord(JSON.stringify({ level: 9 }), `team-skill-assessment:${base.uid}:${base.teamId}:${base.skillId}`);
    const opened = openAssessmentDocument(base.uid, base.teamId, base.skillId, storedRating(notALevel));
    expect((opened as { level: unknown }).level).toBeNull();
  });

  it("fails closed when the encryption key is missing", () => {
    const sealed = sealAssessmentLevel(base.uid, base.teamId, base.skillId, 1);
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => openAssessmentDocument(base.uid, base.teamId, base.skillId, storedRating(sealed))).toThrow();
  });

  it("returns non-record values unchanged", () => {
    expect(openAssessmentDocument(base.uid, base.teamId, base.skillId, undefined)).toBeUndefined();
    expect(openAssessmentDocument(base.uid, base.teamId, base.skillId, "x")).toBe("x");
  });
});

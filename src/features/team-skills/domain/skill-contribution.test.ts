import { describe, expect, it } from "vitest";
import {
  SKILL_CONTRIBUTION_FIELD,
  isEffectiveSkillContribution,
  readSkillContribution,
} from "./skill-contribution";
import { SKILL_CONTRIBUTION_NOTICE_VERSION } from "./skill-coverage-policy";

const at = new Date("2026-01-01T00:00:00Z");
const membership = (value: unknown) => ({ [SKILL_CONTRIBUTION_FIELD]: value });
const current = { noticeVersion: SKILL_CONTRIBUTION_NOTICE_VERSION, consentedAt: at };

describe("skill contribution", () => {
  it("names the membership field", () => {
    expect(SKILL_CONTRIBUTION_FIELD).toBe("skillContribution");
  });

  it("is effective at the current notice version and reuses the policy constant", () => {
    expect(isEffectiveSkillContribution(membership(current))).toBe(true);
    expect(readSkillContribution(membership(current))).toEqual(current);
  });

  it("accepts a Timestamp-like consentedAt", () => {
    const ts = { toDate: () => at };
    expect(isEffectiveSkillContribution(membership({ ...current, consentedAt: ts }))).toBe(true);
  });

  it.each([SKILL_CONTRIBUTION_NOTICE_VERSION - 1, SKILL_CONTRIBUTION_NOTICE_VERSION + 1, 0, 2])(
    "is readable but not effective for version %s",
    (noticeVersion) => {
      const raw = membership({ ...current, noticeVersion });
      expect(readSkillContribution(raw)).not.toBeNull();
      expect(isEffectiveSkillContribution(raw)).toBe(false);
    },
  );

  it("is not effective for a string or fractional version", () => {
    expect(isEffectiveSkillContribution(membership({ ...current, noticeVersion: "1" }))).toBe(false);
    expect(isEffectiveSkillContribution(membership({ ...current, noticeVersion: 1.5 }))).toBe(false);
    expect(readSkillContribution(membership({ ...current, noticeVersion: "1" }))).toBeNull();
  });

  it("treats a missing contribution as not opted in", () => {
    expect(readSkillContribution({})).toBeNull();
    expect(isEffectiveSkillContribution({})).toBe(false);
    expect(isEffectiveSkillContribution(undefined)).toBe(false);
  });

  it.each([null, undefined, 1, "x", true, [], [current]])("fails safely for malformed object %j", (value) => {
    expect(() => readSkillContribution(membership(value))).not.toThrow();
    expect(readSkillContribution(membership(value))).toBeNull();
    expect(isEffectiveSkillContribution(membership(value))).toBe(false);
  });

  it("fails safely for non-object memberships", () => {
    for (const raw of [null, undefined, 1, "x"]) expect(isEffectiveSkillContribution(raw)).toBe(false);
  });

  it("fails safely for malformed consentedAt", () => {
    const throwing = {
      toDate: () => {
        throw new Error("boom");
      },
    };
    for (const bad of [undefined, null, "2026-01-01", 0, new Date("nope"), {}, throwing, { toDate: () => "x" }]) {
      const raw = membership({ ...current, consentedAt: bad });
      expect(() => isEffectiveSkillContribution(raw)).not.toThrow();
      expect(isEffectiveSkillContribution(raw)).toBe(false);
    }
  });

  it("has no enabled semantics: extra or missing keys are not effective", () => {
    expect(isEffectiveSkillContribution(membership({ ...current, enabled: true }))).toBe(false);
    expect(isEffectiveSkillContribution(membership({ enabled: true }))).toBe(false);
    expect(isEffectiveSkillContribution(membership({ enabled: false, ...current }))).toBe(false);
    expect(isEffectiveSkillContribution(membership({ noticeVersion: SKILL_CONTRIBUTION_NOTICE_VERSION }))).toBe(false);
    expect(isEffectiveSkillContribution(membership({ consentedAt: at }))).toBe(false);
  });
});

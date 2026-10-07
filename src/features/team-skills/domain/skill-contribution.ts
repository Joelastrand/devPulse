import { SKILL_CONTRIBUTION_NOTICE_VERSION } from "./skill-coverage-policy";

/**
 * Name of the membership field holding a member's skill participation. This
 * file is the ONLY production owner of the literal; persistence code imports
 * this constant. Presence of a valid object means opt-in: there is no
 * `enabled` flag, no persisted "false" and no consent history.
 */
export const SKILL_CONTRIBUTION_FIELD = "skillContribution";

export interface SkillContributionRecord {
  noticeVersion: number;
  consentedAt: Date;
}

const CONTRIBUTION_KEYS = ["noticeVersion", "consentedAt"] as const;

function toValidDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "object" || value === null) return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return null;
  try {
    const date: unknown = toDate.call(value);
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

/**
 * Reads readable participation metadata from a raw membership document, or
 * `null` when absent or malformed (never throws). Readable is NOT effective:
 * the notice version may be stale; use `isEffectiveSkillContribution`.
 * Shape is exact: only `noticeVersion` (integer) and `consentedAt`
 * (valid Date or Timestamp-like).
 */
export function readSkillContribution(rawMembership: unknown): SkillContributionRecord | null {
  try {
    if (typeof rawMembership !== "object" || rawMembership === null) return null;
    if (!Object.hasOwn(rawMembership, SKILL_CONTRIBUTION_FIELD)) return null;
    const raw: unknown = (rawMembership as Record<string, unknown>)[SKILL_CONTRIBUTION_FIELD];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const keys = Object.keys(raw);
    if (keys.length !== CONTRIBUTION_KEYS.length || !CONTRIBUTION_KEYS.every((key) => Object.hasOwn(raw, key))) {
      return null;
    }
    const { noticeVersion, consentedAt } = raw as Record<string, unknown>;
    if (typeof noticeVersion !== "number" || !Number.isInteger(noticeVersion)) return null;
    const date = toValidDate(consentedAt);
    return date ? { noticeVersion, consentedAt: date } : null;
  } catch {
    return null;
  }
}

/** Effective consent: readable AND `noticeVersion` strictly equals the current version. */
export function isEffectiveSkillContribution(rawMembership: unknown): boolean {
  return readSkillContribution(rawMembership)?.noticeVersion === SKILL_CONTRIBUTION_NOTICE_VERSION;
}

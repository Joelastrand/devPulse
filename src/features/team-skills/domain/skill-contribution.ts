import { SKILL_CONTRIBUTION_NOTICE_VERSION } from "./skill-coverage-policy";

/**
 * Name of the membership field holding a member's skill participation. This
 * file is the ONLY production owner of the literal; persistence code imports
 * this constant. Presence of a valid object means opt-in: there is no
 * `enabled` flag, no persisted "false" and no consent history.
 */
export const SKILL_CONTRIBUTION_FIELD = "skillContribution";

/**
 * The only record shape production code writes. Production writers never set `simulated`.
 */
export interface SkillContributionRecord {
  noticeVersion: number;
  consentedAt: Date;
}

/**
 * Synthetic demo consent (docs/SECURITY.md, "Simulated demo consent"). A membership whose uid is one of the ten fictional
 * demo members and whose team is the designated demo team may carry `simulated: true`. Both values are fixed in code:
 * no configuration, no environment variable and no caller can widen them. The marker never grants authentication or
 * authorization; it only lets the demo aggregate exercise the real consent path, and it is always visible to the reader.
 */
export const SIMULATED_CONTRIBUTION_TEAM_ID = "8yB2bS8Jav69TCfDETON";
export const SIMULATED_CONTRIBUTION_UIDS: readonly string[] = Object.freeze(
  Array.from({ length: 10 }, (_, index) => `demo-member-${String(index + 1).padStart(2, "0")}`),
);
export const SIMULATED_CONTRIBUTION_FIELD = "simulated";

/** Trusted identity context of one membership document: values the caller derived from the verified document id. */
export interface SkillContributionContext {
  uid: string;
  teamId: string;
}

export type SkillContributionOrigin = "genuine" | "simulated";

export interface ReadSkillContribution extends SkillContributionRecord {
  origin: SkillContributionOrigin;
}

const CONTRIBUTION_KEYS = ["noticeVersion", "consentedAt"] as const;

/** True only for the exact fictional uid in the exact designated demo team. A uid match alone is never enough. */
export function isSimulatedContributionContext(context: SkillContributionContext): boolean {
  return context.teamId === SIMULATED_CONTRIBUTION_TEAM_ID && SIMULATED_CONTRIBUTION_UIDS.includes(context.uid);
}

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
 * Reads readable participation metadata from a raw membership document, or `null` when absent or malformed (never
 * throws). Readable is NOT effective: the notice version may be stale; use `isEffectiveSkillContribution`.
 *
 * Shape is exact: `noticeVersion` (integer) and `consentedAt` (valid Date or Timestamp-like). The only extra key allowed
 * is `simulated: true`, and only when `context` names a simulated demo membership; without that context, or with any
 * other extra key, the record is unreadable.
 */
export function readSkillContribution(rawMembership: unknown, context?: SkillContributionContext): ReadSkillContribution | null {
  try {
    if (typeof rawMembership !== "object" || rawMembership === null) return null;
    if (!Object.hasOwn(rawMembership, SKILL_CONTRIBUTION_FIELD)) return null;
    const raw: unknown = (rawMembership as Record<string, unknown>)[SKILL_CONTRIBUTION_FIELD];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

    const simulated = Object.hasOwn(raw, SIMULATED_CONTRIBUTION_FIELD);
    const expectedKeys = simulated ? CONTRIBUTION_KEYS.length + 1 : CONTRIBUTION_KEYS.length;
    if (Object.keys(raw).length !== expectedKeys || !CONTRIBUTION_KEYS.every((key) => Object.hasOwn(raw, key))) return null;

    const { noticeVersion, consentedAt } = raw as Record<string, unknown>;
    if (typeof noticeVersion !== "number" || !Number.isInteger(noticeVersion)) return null;
    if (simulated) {
      if ((raw as Record<string, unknown>)[SIMULATED_CONTRIBUTION_FIELD] !== true) return null;
      if (context === undefined || !isSimulatedContributionContext(context)) return null;
    }
    const date = toValidDate(consentedAt);
    return date ? { noticeVersion, consentedAt: date, origin: simulated ? "simulated" : "genuine" } : null;
  } catch {
    return null;
  }
}

/** Effective consent: readable AND `noticeVersion` strictly equals the current version. */
export function isEffectiveSkillContribution(rawMembership: unknown, context?: SkillContributionContext): boolean {
  return readSkillContribution(rawMembership, context)?.noticeVersion === SKILL_CONTRIBUTION_NOTICE_VERSION;
}

/**
 * The only way a simulated consent field is built. It refuses any context outside the fixed demo scope, so a caller
 * cannot produce the marker for a real member. Used by the demo seeder; production writers never call it.
 */
export function simulatedContributionPatch(
  context: SkillContributionContext,
  consentedAt: Date,
): Record<string, unknown> {
  if (!isSimulatedContributionContext(context)) throw new Error("simulated consent refused outside the demo scope");
  return {
    [SKILL_CONTRIBUTION_FIELD]: { noticeVersion: SKILL_CONTRIBUTION_NOTICE_VERSION, consentedAt, simulated: true },
  };
}

/** Whether a raw membership carries the consent field at all (any shape). Used by the demo seeder's preflight. */
export function hasSkillContributionField(rawMembership: object): boolean {
  return Object.hasOwn(rawMembership, SKILL_CONTRIBUTION_FIELD);
}

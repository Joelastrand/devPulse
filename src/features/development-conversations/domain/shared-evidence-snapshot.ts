import { isValidPlanDate } from "./plan-date";
import { SHARED_EVIDENCE_MAX_ACHIEVEMENTS, SHARED_EVIDENCE_MAX_RESPONSIBILITIES } from "./conversation-constants";
import { hasExactKeys, isPlainObject, parseCanonicalInstant } from "./stored-shape";
import { normalizeNote, normalizeTitle } from "./text-rules";

/**
 * Evidence snapshots (AD-2, BR-40 to BR-47, Amendment C2). A snapshot is a copy of an owner-selected responsibility or
 * achievement. It carries no source id, no goal or responsibility link, no owner uid and no `createdAt` or `updatedAt`,
 * so it grants nothing and points at nothing. It exists only inside the encrypted `sharedEvidence` array (BR-51 v2).
 *
 * The vocabulary is local, not imported from the personal-role-workspace feature. D2 never imports personal domain code.
 * The parser reads the decrypted JSON form: `capturedAt` is a canonical ISO string there and is returned as a `Date`.
 * Stored text is valid as written or the item is malformed. Nothing is trimmed or normalised on read (BR-33).
 */

export const EVIDENCE_KINDS = ["responsibility", "achievement"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

const RESPONSIBILITY_STATUSES = ["active", "completed"] as const;
const RELATIONS_TO_ROLE = ["within", "beyond", "unspecified"] as const;

export const RESPONSIBILITY_SNAPSHOT_KEYS = [
  "kind",
  "title",
  "description",
  "status",
  "relationToRole",
  "period",
  "capturedAt",
] as const;
export const ACHIEVEMENT_SNAPSHOT_KEYS = ["kind", "title", "description", "outcome", "period", "relationToRole", "capturedAt"] as const;
export const SNAPSHOT_PERIOD_KEYS = ["start", "end"] as const;

export type SnapshotPeriod = { start: string | null; end: string | null };

export type ResponsibilitySnapshot = {
  kind: "responsibility";
  title: string;
  description: string | null;
  status: (typeof RESPONSIBILITY_STATUSES)[number];
  relationToRole: (typeof RELATIONS_TO_ROLE)[number];
  period: SnapshotPeriod;
  capturedAt: Date;
};

export type AchievementSnapshot = {
  kind: "achievement";
  title: string;
  description: string;
  outcome: string | null;
  period: SnapshotPeriod;
  relationToRole: (typeof RELATIONS_TO_ROLE)[number];
  capturedAt: Date;
};

export type SharedEvidenceSnapshot = ResponsibilitySnapshot | AchievementSnapshot;

export type ParseResult<T> = { ok: true; value: T } | { ok: false };

const fail = <T>(): ParseResult<T> => ({ ok: false });

/** A text field is canonical when the note or title rule accepts it and the normalised text equals the stored text. */
function canonicalTitle(value: unknown): string | null {
  const result = normalizeTitle(value);
  return result.ok && result.text === value ? result.text : null;
}

function canonicalNote(value: unknown): string | null {
  const result = normalizeNote(value);
  return result.ok && result.text === value ? result.text : null;
}

function parsePeriod(value: unknown): SnapshotPeriod | null {
  if (!isPlainObject(value) || !hasExactKeys(value, SNAPSHOT_PERIOD_KEYS)) return null;
  const { start, end } = value;
  const validStart = start === null || isValidPlanDate(start);
  const validEnd = end === null || isValidPlanDate(end);
  if (!validStart || !validEnd) return null;
  if (typeof start === "string" && typeof end === "string" && start > end) return null;
  return { start: start as string | null, end: end as string | null };
}

function parseCapturedAt(value: unknown): Date | null {
  return parseCanonicalInstant(value);
}

function parseResponsibility(data: Record<string, unknown>): ParseResult<ResponsibilitySnapshot> {
  const { title, description, status, relationToRole, period, capturedAt } = data;
  const titleText = canonicalTitle(title);
  if (titleText === null) return fail();
  // A responsibility description is optional. `null` is absent; an empty string is not stored.
  let descriptionText: string | null = null;
  if (description !== null) {
    descriptionText = canonicalNote(description);
    if (descriptionText === null || descriptionText.length === 0) return fail();
  }
  if (!(RESPONSIBILITY_STATUSES as readonly unknown[]).includes(status)) return fail();
  if (!(RELATIONS_TO_ROLE as readonly unknown[]).includes(relationToRole)) return fail();
  const parsedPeriod = parsePeriod(period);
  const instant = parseCapturedAt(capturedAt);
  if (parsedPeriod === null || instant === null) return fail();
  return {
    ok: true,
    value: {
      kind: "responsibility",
      title: titleText,
      description: descriptionText,
      status: status as ResponsibilitySnapshot["status"],
      relationToRole: relationToRole as ResponsibilitySnapshot["relationToRole"],
      period: parsedPeriod,
      capturedAt: instant,
    },
  };
}

function parseAchievement(data: Record<string, unknown>): ParseResult<AchievementSnapshot> {
  const { title, description, outcome, relationToRole, period, capturedAt } = data;
  const titleText = canonicalTitle(title);
  // An achievement description is required (BR-20). Its outcome is optional.
  const descriptionText = canonicalNote(description);
  if (titleText === null || descriptionText === null || descriptionText.length === 0) return fail();
  let outcomeText: string | null = null;
  if (outcome !== null) {
    outcomeText = canonicalNote(outcome);
    if (outcomeText === null || outcomeText.length === 0) return fail();
  }
  if (!(RELATIONS_TO_ROLE as readonly unknown[]).includes(relationToRole)) return fail();
  const parsedPeriod = parsePeriod(period);
  const instant = parseCapturedAt(capturedAt);
  if (parsedPeriod === null || instant === null) return fail();
  return {
    ok: true,
    value: {
      kind: "achievement",
      title: titleText,
      description: descriptionText,
      outcome: outcomeText,
      period: parsedPeriod,
      relationToRole: relationToRole as AchievementSnapshot["relationToRole"],
      capturedAt: instant,
    },
  };
}

/**
 * Validates one decrypted evidence snapshot against its exact allow-list. Extra or missing keys, an unknown kind, or any
 * value that would need repair is rejected. Errors carry no value, so a malformed item cannot echo private content.
 */
export function parseSharedEvidenceSnapshot(data: unknown): ParseResult<SharedEvidenceSnapshot> {
  if (!isPlainObject(data)) return fail();
  if (data.kind === "responsibility") {
    return hasExactKeys(data, RESPONSIBILITY_SNAPSHOT_KEYS) ? parseResponsibility(data) : fail();
  }
  if (data.kind === "achievement") {
    return hasExactKeys(data, ACHIEVEMENT_SNAPSHOT_KEYS) ? parseAchievement(data) : fail();
  }
  return fail();
}

/**
 * Validates the decrypted `sharedEvidence` array: at most five responsibilities and five achievements (BR-42). Any invalid
 * item makes the whole list invalid. Nothing is dropped silently.
 */
export function parseSharedEvidenceList(value: unknown): ParseResult<SharedEvidenceSnapshot[]> {
  if (!Array.isArray(value)) return fail();
  const items: SharedEvidenceSnapshot[] = [];
  let responsibilities = 0;
  let achievements = 0;
  for (const entry of value as unknown[]) {
    const parsed = parseSharedEvidenceSnapshot(entry);
    if (!parsed.ok) return fail();
    if (parsed.value.kind === "responsibility") responsibilities += 1;
    else achievements += 1;
    items.push(parsed.value);
  }
  if (responsibilities > SHARED_EVIDENCE_MAX_RESPONSIBILITIES || achievements > SHARED_EVIDENCE_MAX_ACHIEVEMENTS) return fail();
  return { ok: true, value: items };
}

/** The plaintext form of one snapshot, with a fixed key order and `capturedAt` as a canonical ISO string. */
export function serializeSharedEvidenceSnapshot(snapshot: SharedEvidenceSnapshot): Record<string, unknown> {
  const period = { start: snapshot.period.start, end: snapshot.period.end };
  if (snapshot.kind === "responsibility") {
    return {
      kind: snapshot.kind,
      title: snapshot.title,
      description: snapshot.description,
      status: snapshot.status,
      relationToRole: snapshot.relationToRole,
      period,
      capturedAt: snapshot.capturedAt.toISOString(),
    };
  }
  return {
    kind: snapshot.kind,
    title: snapshot.title,
    description: snapshot.description,
    outcome: snapshot.outcome,
    period,
    relationToRole: snapshot.relationToRole,
    capturedAt: snapshot.capturedAt.toISOString(),
  };
}

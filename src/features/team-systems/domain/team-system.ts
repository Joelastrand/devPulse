/**
 * Team system domain model (docs/archive/features/team-system-overview/SPEC.md —
 * D-1, BR-3, BR-8, BR-9, BR-10). Pure functions only: no Firestore, no
 * request handling. Used by the server operations and by the UI for
 * presentation rules, so the risk and attention rules live in exactly one place.
 */

/**
 * Seven quality attributes (SPEC round 2, D-11). `maintainability` is the
 * persisted key of the combined "Vedlikehold og endring" attribute; it is kept
 * so existing assessments are preserved without migration. The four newer keys
 * are absent on legacy documents and read as `ikke_vurdert` (see record parser).
 */
export const ASSESSMENT_ATTRIBUTES = [
  "availability",
  "reliability",
  "maintainability",
  "security",
  "testability",
  "deployability",
  "observability",
] as const;
export type AssessmentAttribute = (typeof ASSESSMENT_ATTRIBUTES)[number];

export const ASSESSMENT_VALUES = ["god", "trenger_oppfolging", "kritisk", "ikke_vurdert"] as const;
export type AssessmentValue = (typeof ASSESSMENT_VALUES)[number];

export const ASSESSMENT_VALUE_LABELS: Record<AssessmentValue, string> = {
  god: "God",
  trenger_oppfolging: "Trenger oppfølging",
  kritisk: "Kritisk",
  ikke_vurdert: "Ikke vurdert",
};

export const ASSESSMENT_ATTRIBUTE_LABELS: Record<AssessmentAttribute, string> = {
  availability: "Tilgjengelighet",
  reliability: "Pålitelighet",
  maintainability: "Vedlikehold og endring",
  security: "Sikkerhet",
  testability: "Testbarhet",
  deployability: "Utrullingsbarhet",
  observability: "Observerbarhet",
};

/** Hard limits, validated server-side. Clients may mirror them for UX only. */
export const TEAM_SYSTEM_LIMITS = {
  nameMax: 120,
  descriptionMax: 1000,
  noteMax: 500,
  backstageUrlMax: 2048,
  knowledgeMembersMax: 50,
  systemsPerTeamMax: 500,
} as const;

export function isAssessmentValue(value: unknown): value is AssessmentValue {
  return typeof value === "string" && (ASSESSMENT_VALUES as readonly string[]).includes(value);
}

export function isAssessmentAttribute(value: unknown): value is AssessmentAttribute {
  return typeof value === "string" && (ASSESSMENT_ATTRIBUTES as readonly string[]).includes(value);
}

/** Knowledge-risk band (BR-9). Fixed, documented rules; never a numeric score. */
export type KnowledgeRiskBand = "none" | "high" | "elevated" | "lower";

export const KNOWLEDGE_RISK_LABELS: Record<KnowledgeRiskBand, string> = {
  none: "Ingen registrert kompetanse",
  high: "Høy kompetanserisiko",
  elevated: "Forhøyet kompetanserisiko",
  lower: "Lavere konsentrasjonsrisiko",
};

/**
 * Band for N resolvable knowledge members. Negative or non-integer counts are
 * programmer errors and are never passed in; they are treated as "none" to
 * fail toward the cautious, visible side.
 */
export function knowledgeRiskBand(memberCount: number): KnowledgeRiskBand {
  if (!Number.isInteger(memberCount) || memberCount <= 0) return "none";
  if (memberCount === 1) return "high";
  if (memberCount === 2) return "elevated";
  return "lower";
}

/** BR-10: attention when any assessment is `kritisk` or `trenger_oppfolging`. */
export function needsAttention(assessments: Record<AssessmentAttribute, { value: AssessmentValue }>): boolean {
  return ASSESSMENT_ATTRIBUTES.some((attribute) => {
    const value = assessments[attribute].value;
    return value === "kritisk" || value === "trenger_oppfolging";
  });
}

/** BR-10 extension for summaries: every attribute positively assessed as `god`. */
export function isInGoodStanding(assessments: Record<AssessmentAttribute, { value: AssessmentValue }>): boolean {
  return ASSESSMENT_ATTRIBUTES.every((attribute) => assessments[attribute].value === "god");
}

export type BackstageUrlResult = { ok: true; value: string | null } | { ok: false };

/**
 * BR-8. Absent or empty input means "no link". Otherwise: a string of at most
 * 2048 characters, no whitespace, an absolute `https:` URL, no credentials and
 * a non-empty hostname. The returned value is the normalized `URL#href`, so a
 * stored value is always what the parser produced.
 */
export function parseBackstageUrl(input: unknown): BackstageUrlResult {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > TEAM_SYSTEM_LIMITS.backstageUrlMax) return { ok: false };
  if (/\s/.test(trimmed)) return { ok: false };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "https:") return { ok: false };
  if (url.username !== "" || url.password !== "") return { ok: false };
  if (url.hostname.length === 0) return { ok: false };
  return { ok: true, value: url.href };
}

/** Trimmed name, 1–120 characters. */
export function parseSystemName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > TEAM_SYSTEM_LIMITS.nameMax) return null;
  return trimmed;
}

/** Optional description: `null` for absent/blank, otherwise trimmed and at most 1000 characters. */
/**
 * Member refs per `memberRef in [...]` lookup. Kept at 10, a conservative
 * Firestore `in` size, so the lookup works on every backend revision; teams
 * with many distinct refs simply take more lookups, never a truncated read.
 */
export const MEMBER_REF_LOOKUP_CHUNK_SIZE = 10;

/** Splits refs into lookup-sized chunks. Pure; no refs are dropped. */
export function chunkMemberRefs(refs: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < refs.length; index += MEMBER_REF_LOOKUP_CHUNK_SIZE) {
    chunks.push(refs.slice(index, index + MEMBER_REF_LOOKUP_CHUNK_SIZE));
  }
  return chunks;
}

export function parseOptionalText(input: unknown, max: number): string | null | undefined {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? undefined : trimmed;
}

/**
 * Limits and fixed vocabulary of the personal role workspace, first increment (SPEC "Data shapes", SECURITY-REVIEW §11.5,
 * SECURITY.md PR-SI-6). Pure constants; no Firebase and no crypto imports.
 */

export const RESPONSIBILITY_CAP = 100;
export const ACHIEVEMENT_CAP = 200;

/** Maximum request body, read as a bounded stream (PR-SI-6). */
export const RECORD_BODY_MAX_BYTES = 16 * 1024;
/** Maximum encrypted envelope of one stored record, checked before the write (PR-SI-6). */
export const ENVELOPE_MAX_BYTES = 32 * 1024;

export const LINK_MAX = 5;
export const TITLE_MAX_CODE_POINTS = 120;
export const DESCRIPTION_MAX_CODE_POINTS = 2000;
export const OUTCOME_MAX_CODE_POINTS = 1000;

export const RELATION_TO_ROLE_VALUES = ["within", "beyond", "unspecified"] as const;
export type RelationToRole = (typeof RELATION_TO_ROLE_VALUES)[number];

export const RESPONSIBILITY_STATUS_VALUES = ["active", "completed"] as const;
export type ResponsibilityStatus = (typeof RESPONSIBILITY_STATUS_VALUES)[number];

/** Envelope version of the source-record codec. Distinct from the conversation codec (`v1` there as well, separate context). */
export const SOURCE_KEY_VERSION = "v1";
/** Domain separation for the source-record key check (CL-27 construction, own context). */
export const SOURCE_KEY_CHECK_CONTEXT = "devpulse.personal-records.source-key-check.v1";
export const SOURCE_KEY_CHECK_BYTES = 32;

/** D2-style addressable id (SECURITY.md PR-SI-6): safe as a Firestore path segment, never `__x__`. */
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isAddressableRecordId(value: unknown): value is string {
  return typeof value === "string" && RECORD_ID_PATTERN.test(value) && !/^__.*__$/.test(value);
}

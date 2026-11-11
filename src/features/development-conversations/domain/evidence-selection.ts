import { SHARED_EVIDENCE_MAX_ACHIEVEMENTS, SHARED_EVIDENCE_MAX_RESPONSIBILITIES } from "./conversation-constants";
import { hasExactKeys, isPlainObject } from "./stored-shape";

/**
 * The owner's evidence selection request (SPEC BR-41, BR-42; SECURITY-REVIEW §11.2, N-E6, N-E7). The body names source ids
 * only. It cannot carry content, a uid or an owner reference: the key set is exact, and any other key is refused.
 *
 * Ids are validated here, before any source read (BR-60). An id that is not addressable is never trimmed or repaired.
 * The per-type limits (BR-42) are checked here too, so an oversized selection reads nothing.
 */

export const EVIDENCE_SELECTION_KEYS = ["responsibilityIds", "achievementIds"] as const;

export type EvidenceSelection = {
  responsibilityIds: string[];
  achievementIds: string[];
};

const EVIDENCE_ID_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

function isAddressableEvidenceId(value: unknown): value is string {
  return typeof value === "string" && EVIDENCE_ID_SEGMENT.test(value) && !value.includes("__");
}

function validIdList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  if (!value.every(isAddressableEvidenceId)) return null;
  if (new Set(value).size !== value.length) return null;
  return value;
}

/** Returns the selection, or `null` for any shape, id, duplicate or limit violation. The caller maps `null` to one error. */
export function parseEvidenceSelection(value: unknown): EvidenceSelection | null {
  if (!isPlainObject(value) || !hasExactKeys(value, EVIDENCE_SELECTION_KEYS)) return null;
  const responsibilityIds = validIdList(value.responsibilityIds, SHARED_EVIDENCE_MAX_RESPONSIBILITIES);
  const achievementIds = validIdList(value.achievementIds, SHARED_EVIDENCE_MAX_ACHIEVEMENTS);
  if (responsibilityIds === null || achievementIds === null) return null;
  return { responsibilityIds, achievementIds };
}

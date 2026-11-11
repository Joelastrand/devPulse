import { NEXT_STEPS_MAX_ITEMS, SHARED_GOALS_MAX } from "./conversation-constants";
import { hasExactKeys, isPlainObject } from "./stored-shape";
import { parseSharedGoalSnapshot, type SharedGoalSnapshot } from "./shared-goal-snapshot";
import { parseSharedEvidenceList, type SharedEvidenceSnapshot } from "./shared-evidence-snapshot";
import { normalizeNote, normalizeNextStep, normalizeTitle } from "./text-rules";

/**
 * The decrypted content payload (SPEC BR-51, Amendment C2). The whole payload is encrypted as one JSON object with one of
 * two exact key sets. Payload v1 is the original five keys and is read unchanged. Payload v2 adds `sharedEvidence`. No
 * other key set is accepted. This parser runs only after decryption, so it receives the parsed JSON value. Every field is
 * checked against the text rules and limits. A value that would need trimming or normalising is rejected, not repaired:
 * stored content is valid as written or it is malformed (BR-33).
 */
export const CONTENT_PAYLOAD_KEYS_V1 = ["title", "ownerNotes", "nextSteps", "participantNotes", "sharedGoals"] as const;
export const CONTENT_PAYLOAD_KEYS_V2 = [...CONTENT_PAYLOAD_KEYS_V1, "sharedEvidence"] as const;

export type ConversationContent = {
  title: string;
  ownerNotes: string;
  nextSteps: string[];
  participantNotes: string;
  sharedGoals: SharedGoalSnapshot[];
  /** Absent in v1 payloads, which read as `[]` (Amendment C2). Always present in memory. */
  sharedEvidence: SharedEvidenceSnapshot[];
};

export type ParseConversationContentResult = { ok: true; content: ConversationContent } | { ok: false };

/** A note field is canonical when it is NFC and passes the note rules. Empty is valid (BR-20). */
function isCanonicalNote(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const note = normalizeNote(value);
  return note.ok && note.text === value;
}

function parseNextSteps(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > NEXT_STEPS_MAX_ITEMS) {
    return null;
  }
  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    const step = typeof entry === "string" ? normalizeNextStep(entry) : null;
    if (step === null || !step.ok || step.text !== entry) {
      return null;
    }
    items.push(step.text);
  }
  return items;
}

function parseSharedGoals(value: unknown): SharedGoalSnapshot[] | null {
  if (!Array.isArray(value) || value.length > SHARED_GOALS_MAX) {
    return null;
  }
  const snapshots: SharedGoalSnapshot[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseSharedGoalSnapshot(value[index]);
    if (!parsed.ok) {
      return null;
    }
    snapshots.push(parsed.snapshot);
  }
  return snapshots;
}

/** Validates a decrypted payload. Errors carry no value, so a malformed payload cannot echo private content. */
export function parseConversationContent(payload: unknown): ParseConversationContentResult {
  if (!isPlainObject(payload)) {
    return { ok: false };
  }
  if (hasExactKeys(payload, CONTENT_PAYLOAD_KEYS_V2)) {
    const evidence = parseSharedEvidenceList(payload.sharedEvidence);
    if (!evidence.ok) {
      return { ok: false };
    }
    return parseCommonFields(payload, evidence.value);
  }
  if (hasExactKeys(payload, CONTENT_PAYLOAD_KEYS_V1)) {
    return parseCommonFields(payload, []);
  }
  return { ok: false };
}

function parseCommonFields(payload: Record<string, unknown>, sharedEvidence: SharedEvidenceSnapshot[]): ParseConversationContentResult {
  const { title, ownerNotes, nextSteps, participantNotes, sharedGoals } = payload;

  if (typeof title !== "string") {
    return { ok: false };
  }
  const titleResult = normalizeTitle(title);
  if (!titleResult.ok || titleResult.text !== title) {
    return { ok: false };
  }
  if (!isCanonicalNote(ownerNotes) || !isCanonicalNote(participantNotes)) {
    return { ok: false };
  }
  const steps = parseNextSteps(nextSteps);
  const goals = parseSharedGoals(sharedGoals);
  if (steps === null || goals === null) {
    return { ok: false };
  }

  return {
    ok: true,
    content: { title, ownerNotes, nextSteps: steps, participantNotes, sharedGoals: goals, sharedEvidence },
  };
}

import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * Encryption of user-authored text in `teamSystems/{systemId}`:
 * - `name` and `description`, sealed together as `content` (context `team-system:<teamId>:<systemId>`).
 * - each assessment attribute's `note`, sealed as its own envelope (context
 *   `team-system-note:<teamId>:<systemId>:<attribute>`); a `null` note stays `null`.
 *
 * The attribute value, the assessment timestamp and the audit actor (`assessedBy`, never returned to clients) stay
 * plaintext. So do the backstage URL, knowledge references and the team id.
 *
 * Fail-closed: a missing key throws. An unopenable value, or a plaintext name, description or note, is refused by
 * returning a value the domain parser rejects (`undefined` for a required field, `false` for a note).
 */

export const SYSTEM_CONTENT_FIELD = "content";
const PLAINTEXT_CONTENT_KEYS = ["name", "description"] as const;

function systemContext(teamId: string, systemId: string): string {
  return `team-system:${teamId}:${systemId}`;
}

function noteContext(teamId: string, systemId: string, attribute: string): string {
  return `team-system-note:${teamId}:${systemId}:${attribute}`;
}

function openJson(value: unknown, context: string): Record<string, unknown> | null {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) return null;
  try {
    const parsed: unknown = JSON.parse(decryptRecord(envelope, context));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
}

function sealNote(teamId: string, systemId: string, attribute: string, note: unknown): RecordEnvelope | null {
  if (note === null) return null;
  if (typeof note !== "string") throw new Error("system note is invalid");
  return encryptRecord(JSON.stringify({ note }), noteContext(teamId, systemId, attribute));
}

/** Seals the system's business text and its attribute notes. The caller passes the full document. */
export function toPersistedTeamSystem(systemId: string, data: Record<string, unknown>): Record<string, unknown> {
  const { name, description, assessments, ...rest } = data;
  if (typeof name !== "string" || (description !== null && typeof description !== "string") || typeof rest.teamId !== "string") {
    throw new Error("team system content is incomplete");
  }
  const teamId = rest.teamId;
  const sealedAssessments = Object.fromEntries(
    Object.entries((assessments ?? {}) as Record<string, Record<string, unknown>>).map(([attribute, assessment]) => [
      attribute,
      { ...assessment, note: sealNote(teamId, systemId, attribute, assessment.note) },
    ]),
  );
  const content = encryptRecord(JSON.stringify({ name, description }), systemContext(teamId, systemId));
  return { ...rest, assessments: sealedAssessments, [SYSTEM_CONTENT_FIELD]: content };
}

function openNote(value: unknown, teamId: string, systemId: string, attribute: string): string | null | false {
  if (value === null) return null;
  const content = openJson(value, noteContext(teamId, systemId, attribute));
  return content !== null && typeof content.note === "string" ? content.note : false;
}

/**
 * Opens a stored system. A document with plaintext business text, or without a team id, opens as `null`. A required field
 * that cannot be opened is omitted, and a note that cannot be opened is `false`. The domain parser refuses all of these.
 */
export function openTeamSystemDocument(systemId: string, data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const { [SYSTEM_CONTENT_FIELD]: sealed, ...metadata } = data as Record<string, unknown>;
  // A plaintext name or description is never accepted (no plaintext fallback).
  if (PLAINTEXT_CONTENT_KEYS.some((key) => Object.hasOwn(metadata, key)) || typeof metadata.teamId !== "string") return null;
  const teamId = metadata.teamId;
  const content = openJson(sealed, systemContext(teamId, systemId));
  const assessments = metadata.assessments;
  const openedAssessments =
    typeof assessments === "object" && assessments !== null
      ? Object.fromEntries(
          Object.entries(assessments as Record<string, Record<string, unknown>>).map(([attribute, assessment]) => [
            attribute,
            { ...assessment, note: openNote(assessment.note, teamId, systemId, attribute) },
          ]),
        )
      : assessments;
  return {
    ...metadata,
    ...(content !== null && typeof content.name === "string" ? { name: content.name } : {}),
    ...(content !== null && (typeof content.description === "string" || content.description === null) ? { description: content.description } : {}),
    assessments: openedAssessments,
  };
}

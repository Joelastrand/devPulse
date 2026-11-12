import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * Encryption of user-authored text in team project records:
 * - `teamProjects/{projectId}.title`, sealed as `content` (context `team-project:<teamId>:<projectId>`).
 * - `teamProjectParticipations/{participationId}.note`, sealed as its own envelope (context
 *   `team-project-participation:<teamId>:<participationId>`); `null` stays `null` (it records only that no note exists).
 *
 * Plaintext stays for identifiers, lifecycle, priority and the planning dates. The dates drive the lane, overlap and sort
 * computations on the server and are scheduling metadata, not free text.
 *
 * Fail-closed: an unopenable title or note is returned as a value the domain parser refuses (a missing title, or a
 * non-string note). A plaintext title or note is never accepted. A missing key throws.
 */

export const PROJECT_CONTENT_FIELD = "content";

function projectContext(teamId: string, projectId: string): string {
  return `team-project:${teamId}:${projectId}`;
}

function participationContext(teamId: string, participationId: string): string {
  return `team-project-participation:${teamId}:${participationId}`;
}

function openJson(envelopeValue: unknown, context: string): Record<string, unknown> | null {
  const envelope = readRecordEnvelope(envelopeValue);
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

// ---- Team projects ----

/** Seals the project title. The caller passes the full stored document; `title` must be a string. */
export function toPersistedTeamProject(projectId: string, data: Record<string, unknown>): Record<string, unknown> {
  const { title, ...rest } = data;
  if (typeof title !== "string" || typeof rest.teamId !== "string") throw new Error("team project content is incomplete");
  const sealed: RecordEnvelope = encryptRecord(JSON.stringify({ title }), projectContext(rest.teamId, projectId));
  return { ...rest, [PROJECT_CONTENT_FIELD]: sealed };
}

/** Opens a stored project. Returns `null` for a document that cannot be opened or still carries a plaintext title. */
export function openTeamProjectDocument(projectId: string, data: Record<string, unknown>): Record<string, unknown> | null {
  const { [PROJECT_CONTENT_FIELD]: sealed, ...metadata } = data;
  if (Object.hasOwn(metadata, "title") || typeof metadata.teamId !== "string") return null;
  const content = openJson(sealed, projectContext(metadata.teamId, projectId));
  return content !== null && typeof content.title === "string" ? { ...metadata, title: content.title } : null;
}

// ---- Project participations ----

/** Seals the optional note of a participation record. */
export function toPersistedParticipation(participationId: string, data: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(data, "note")) return data;
  const { note, ...rest } = data;
  if (note === undefined) return rest;
  if (note !== null && typeof note !== "string") throw new Error("participation note is invalid");
  if (typeof rest.teamId !== "string") throw new Error("participation content is incomplete");
  if (note === null) return { ...rest, note: null };
  const sealed = encryptRecord(JSON.stringify({ note }), participationContext(rest.teamId, participationId));
  return { ...rest, note: sealed };
}

/**
 * Opens the note of a stored participation. A plaintext string or an unopenable envelope becomes `false`, which the domain
 * parser refuses (it accepts only a string, `null` or no note), so the record is treated as malformed.
 */
export function openParticipationDocument(participationId: string, data: Record<string, unknown>): Record<string, unknown> {
  const { note } = data;
  if (note === undefined || note === null) return data;
  if (typeof data.teamId !== "string") return { ...data, note: false };
  const content = openJson(note, participationContext(data.teamId, participationId));
  return { ...data, note: content !== null && typeof content.note === "string" ? content.note : false };
}

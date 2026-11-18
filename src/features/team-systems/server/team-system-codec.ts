import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";
import { ASSESSMENT_ATTRIBUTES, UNASSESSED_CLASSIFICATION } from "../domain/team-system";

/**
 * Encryption of user-authored text in `teamSystems/{systemId}`. One canonical stored shape, shared by the writer, this codec
 * and the domain parser (`parseTeamSystemRecord`):
 * - `content`: `name` and `description`, sealed together (context `team-system:<teamId>:<systemId>`).
 * - each assessment attribute (`availability`, `deployability`, …) is a TOP-LEVEL field
 *   `{ value, note, assessedAt, assessedBy }`. Its `note` is sealed as its own envelope (context
 *   `team-system-note:<teamId>:<systemId>:<attribute>`); a `null` note stays `null`.
 *
 * `value`, `assessedAt` and the audit actor `assessedBy` stay plaintext. `assessedBy` is never returned to clients. The
 * backstage URL, knowledge references and the team id stay plaintext too.
 *
 * There is no plaintext compatibility path. A plaintext name, description or note is refused on read, and an unopenable
 * envelope is refused the same way. A missing key throws. Nothing here falls back to reading plaintext.
 */

export const SYSTEM_CONTENT_FIELD = "content";

type OpenRecord = (envelope: RecordEnvelope, context: string) => string;
type SealRecord = (plaintext: string, context: string) => RecordEnvelope;

/** Every user-authored or classification value that is sealed in `content`. A plaintext copy of any of them is refused on read. */
const PLAINTEXT_CONTENT_KEYS = ["name", "description", "systemType", "businessCriticality", "userReach"] as const;

function systemContext(teamId: string, systemId: string): string {
  return `team-system:${teamId}:${systemId}`;
}

function noteContext(teamId: string, systemId: string, attribute: string): string {
  return `team-system-note:${teamId}:${systemId}:${attribute}`;
}

function openJson(value: unknown, context: string, open: OpenRecord = decryptRecord): Record<string, unknown> | null {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) return null;
  try {
    const parsed: unknown = JSON.parse(open(envelope, context));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
}

function sealNote(teamId: string, systemId: string, attribute: string, note: unknown, seal: SealRecord): RecordEnvelope | null {
  if (note === null) return null;
  if (typeof note !== "string") throw new Error("system note is invalid");
  return seal(JSON.stringify({ note }), noteContext(teamId, systemId, attribute));
}

/** Seals the system's name and description together, and each attribute note under its own AAD. The caller passes the full document. */
export function toPersistedTeamSystem(
  systemId: string,
  data: Record<string, unknown>,
  seal: SealRecord = encryptRecord,
): Record<string, unknown> {
  const { name, description, systemType, businessCriticality, userReach, ...rest } = data;
  if (typeof name !== "string" || (description !== null && typeof description !== "string") || typeof rest.teamId !== "string") {
    throw new Error("team system content is incomplete");
  }
  // A missing classification seals as "not assessed" in every dimension. It is never guessed, and the writer always passes it explicitly.
  const classification = {
    systemType: systemType ?? UNASSESSED_CLASSIFICATION.systemType,
    businessCriticality: businessCriticality ?? UNASSESSED_CLASSIFICATION.businessCriticality,
    userReach: userReach ?? UNASSESSED_CLASSIFICATION.userReach,
  };
  const teamId = rest.teamId;
  const sealedAttributes: Record<string, unknown> = {};
  for (const attribute of ASSESSMENT_ATTRIBUTES) {
    const assessment = rest[attribute];
    if (assessment === undefined) continue;
    if (typeof assessment !== "object" || assessment === null) throw new Error("system assessment is invalid");
    const current = assessment as Record<string, unknown>;
    sealedAttributes[attribute] = { ...current, note: sealNote(teamId, systemId, attribute, current.note, seal) };
  }
  const content = seal(
    JSON.stringify({ name, description, ...classification }),
    systemContext(teamId, systemId),
  );
  return { ...rest, ...sealedAttributes, [SYSTEM_CONTENT_FIELD]: content };
}

/** A note: `null` stays `null`; an opened string is returned; anything unopenable or plaintext is `false` (refused by the parser). */
function openNote(value: unknown, teamId: string, systemId: string, attribute: string, open: OpenRecord): string | null | false {
  if (value === null) return null;
  const content = openJson(value, noteContext(teamId, systemId, attribute), open);
  return content !== null && typeof content.note === "string" ? content.note : false;
}

/** The sealed classification, only where every value is a string; the domain parser normalizes unknown values. */
function openedClassification(content: Record<string, unknown>): Record<string, string> {
  const keys = ["systemType", "businessCriticality", "userReach"] as const;
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = content[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Opens a stored system into the domain shape: top-level attributes with their notes opened, and `name`/`description` from
 * the sealed content. A document with plaintext name or description, or without a team id, opens as `null`. A required field
 * that cannot be opened is omitted, and an unopenable or plaintext note is `false`. The domain parser refuses all of these.
 */
export function openTeamSystemDocument(systemId: string, data: unknown, open: OpenRecord = decryptRecord): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const { [SYSTEM_CONTENT_FIELD]: sealed, ...metadata } = data as Record<string, unknown>;
  // A plaintext name or description is never accepted (no plaintext fallback).
  if (PLAINTEXT_CONTENT_KEYS.some((key) => Object.hasOwn(metadata, key)) || typeof metadata.teamId !== "string") return null;
  const teamId = metadata.teamId;
  const content = openJson(sealed, systemContext(teamId, systemId), open);
  const opened: Record<string, unknown> = { ...metadata };
  for (const attribute of ASSESSMENT_ATTRIBUTES) {
    const assessment = metadata[attribute];
    if (typeof assessment !== "object" || assessment === null || Array.isArray(assessment)) continue;
    const current = assessment as Record<string, unknown>;
    opened[attribute] = { ...current, note: openNote(current.note, teamId, systemId, attribute, open) };
  }
  return {
    ...opened,
    ...(content !== null && typeof content.name === "string" ? { name: content.name } : {}),
    ...(content !== null && (typeof content.description === "string" || content.description === null) ? { description: content.description } : {}),
    ...(content !== null ? openedClassification(content) : {}),
  };
}

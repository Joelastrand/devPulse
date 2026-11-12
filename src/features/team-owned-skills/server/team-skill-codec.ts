import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";
import { isPlainObject, type TeamSkillGuidance, type TeamSkillRecord } from "../domain/team-skill";

/**
 * Encryption of a team skill's business content (name, description, category and level guidance) in
 * `teamSkills/{skillId}`. The four fields are sealed together as one v2 envelope bound to `team-skill:<teamId>:<skillId>`,
 * so the content cannot be moved to another team or another skill document.
 *
 * Plaintext stays for identifiers and operational metadata: `teamId` (query key), `criteriaVersion`, `active`,
 * `sortOrder`, timestamps and the actor ids.
 *
 * Fail-closed: a document without a valid envelope, or whose envelope fails authentication, is opened as `null`, which the
 * domain validator refuses. A document that still carries plaintext business keys is refused the same way, so a plaintext
 * copy never validates (no plaintext fallback).
 */

/** The sealed business fields of a team skill. */
export interface TeamSkillContent {
  name: string;
  description: string;
  category: string | null;
  guidance: TeamSkillGuidance;
}

export const TEAM_SKILL_CONTENT_FIELD = "content";
const SEALED_KEYS = ["name", "description", "category", "guidance"] as const;

function teamSkillContext(teamId: string, skillId: string): string {
  return `team-skill:${teamId}:${skillId}`;
}

export function sealTeamSkillContent(teamId: string, skillId: string, content: TeamSkillContent): RecordEnvelope {
  return encryptRecord(JSON.stringify(content), teamSkillContext(teamId, skillId));
}

/** Splits a domain record into its plaintext metadata and its sealed content, ready for persistence. */
export function toPersistedTeamSkill(skillId: string, record: TeamSkillRecord): Record<string, unknown> {
  const { name, description, category, guidance, ...metadata } = record;
  return { ...metadata, [TEAM_SKILL_CONTENT_FIELD]: sealTeamSkillContent(record.teamId, skillId, { name, description, category, guidance }) };
}

/**
 * Opens a stored team skill document back into the domain shape (plaintext fields restored from the envelope). Returns
 * `undefined` for an absent document, `null` for anything that cannot be opened or that carries plaintext content.
 */
export function openTeamSkillDocument(skillId: string, data: unknown): unknown {
  if (data === undefined) return undefined;
  if (!isPlainObject(data)) return null;
  const { [TEAM_SKILL_CONTENT_FIELD]: sealed, ...metadata } = data;
  if (SEALED_KEYS.some((key) => Object.hasOwn(metadata, key))) return null;
  if (typeof metadata.teamId !== "string") return null;
  const content = openContent(metadata.teamId, skillId, sealed);
  return content === null ? null : { ...metadata, ...content };
}

function openContent(teamId: string, skillId: string, value: unknown): TeamSkillContent | null {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptRecord(envelope, teamSkillContext(teamId, skillId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  // Shape only; the domain validator decides whether the values are acceptable.
  return { name: parsed.name, description: parsed.description, category: parsed.category, guidance: parsed.guidance } as TeamSkillContent;
}

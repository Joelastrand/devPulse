import "server-only";
import {
  decryptRecord,
  encryptRecord,
  readRecordEnvelope,
  RecordEnvelopeError,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";

/**
 * Encryption of a survey's authored content (title, description, questions) in `surveys/{surveyId}`. The three fields are
 * sealed together as one v2 envelope bound to `survey:<teamId>:<surveyId>`, so the content cannot be moved to another
 * survey or team.
 *
 * Plaintext stays for identifiers, access mode, the per-survey threshold, the question-set version, lifecycle timestamps
 * and actor ids: those drive authorization, the threshold and the lifecycle, and they are not free text.
 *
 * Fail-closed: a document whose envelope is missing, malformed or fails authentication opens as `null`, which the domain
 * validator refuses. A document that still carries plaintext content keys is refused the same way, so a plaintext copy
 * never validates.
 *
 * The seal and open functions are parameters so the demo seeder can use its injected crypto. The default is the
 * process-wide record envelope.
 */

export const SURVEY_CONTENT_FIELD = "content";
const SEALED_KEYS = ["title", "description", "questions"] as const;

export type SealSurveyContent = (plaintext: string, context: string) => RecordEnvelope;
export type OpenSurveyContent = (envelope: RecordEnvelope, context: string) => string;

export function surveyContentContext(teamId: string, surveyId: string): string {
  return `survey:${teamId}:${surveyId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Splits a survey record into plaintext metadata and the sealed content object. Only `title`, `description` and
 * `questions` are moved; every other field stays as metadata. Exported so seeders reuse the exact split.
 */
export function splitSurveyContent(record: Record<string, unknown>): {
  metadata: Record<string, unknown>;
  content: Record<string, unknown>;
} {
  const { title, description, questions, ...metadata } = record;
  const content: Record<string, unknown> = { questions };
  if (title !== undefined) content.title = title;
  if (description !== undefined) content.description = description;
  return { metadata, content };
}

/**
 * Persisted shape of one survey: plaintext metadata plus one envelope holding the authored content. Throws when the record
 * has no team, because the envelope context needs it and the document could never be opened again without it.
 */
export function toPersistedSurvey(
  surveyId: string,
  record: Record<string, unknown>,
  seal: SealSurveyContent = encryptRecord,
): Record<string, unknown> {
  const { metadata, content } = splitSurveyContent(record);
  if (typeof metadata.teamId !== "string") throw new Error("survey_document_without_team");
  const sealed = seal(JSON.stringify(content), surveyContentContext(metadata.teamId, surveyId));
  return { ...metadata, [SURVEY_CONTENT_FIELD]: sealed };
}

/**
 * Opens a stored survey document back into its plaintext shape (authored fields restored from the envelope). Returns
 * `undefined` for an absent document and `null` for anything that cannot be opened or that carries plaintext content.
 */
export function openSurveyDocument(surveyId: string, data: unknown, open: OpenSurveyContent = decryptRecord): unknown {
  if (data === undefined) return undefined;
  if (!isPlainRecord(data)) return null;
  const { [SURVEY_CONTENT_FIELD]: sealed, ...metadata } = data;
  if (SEALED_KEYS.some((key) => Object.hasOwn(metadata, key))) return null;
  if (typeof metadata.teamId !== "string") return null;
  const content = openContent(metadata.teamId, surveyId, sealed, open);
  return content === null ? null : { ...metadata, ...content };
}

function openContent(
  teamId: string,
  surveyId: string,
  value: unknown,
  open: OpenSurveyContent,
): Record<string, unknown> | null {
  const envelope = readRecordEnvelope(value);
  if (envelope === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(open(envelope, surveyContentContext(teamId, surveyId)));
  } catch (error) {
    if (error instanceof RecordEnvelopeError && error.code !== "authentication_failed" && error.code !== "malformed") {
      throw error;
    }
    return null;
  }
  if (!isPlainRecord(parsed)) return null;
  // Shape only: the domain validator (`isValidSurvey`) decides whether the restored values are acceptable.
  const restored: Record<string, unknown> = { questions: parsed.questions };
  if (parsed.title !== undefined) restored.title = parsed.title;
  if (parsed.description !== undefined) restored.description = parsed.description;
  return restored;
}

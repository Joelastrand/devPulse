import { validateSurveyAnswers } from "./answers";
import {
  validateAnswers,
  type AnswerValue,
  type SurveyQuestion,
} from "./question-definitions";
import { isLegacySurvey, resolveSurveyQuestions } from "./survey";

/**
 * Plaintext response payloads, before AES-GCM encryption (team-survey-builder
 * SPEC — "Compatibility"). Legacy surveys keep the original `[flow, stress,
 * fun]` array, so existing encrypted responses decode unchanged. Configurable
 * surveys store `{"version": 2, "answers": {questionId: value}}`. The survey,
 * not the response, decides which format applies, so no response record needs
 * a new field.
 */
export const CONFIGURED_PAYLOAD_VERSION = 2;

export interface SurveyPayloadSource {
  questions?: SurveyQuestion[];
  questionSetVersion?: unknown;
}

/**
 * Validates a respondent's untrusted answers against the survey's own question
 * set and returns the plaintext to encrypt, or `null` on any invalid input.
 * Accepts the legacy array for legacy surveys and an answers object for both.
 */
export function encodeResponsePayload(survey: SurveyPayloadSource, raw: unknown): string | null {
  const questions = resolveSurveyQuestions(survey);

  if (isLegacySurvey(survey)) {
    if (Array.isArray(raw)) {
      const legacy = validateSurveyAnswers(raw);
      return legacy.ok ? JSON.stringify(legacy.data) : null;
    }
    const answers = validateAnswers(questions, raw);
    if (!answers.ok) {
      return null;
    }
    const values = questions.map((question) => answers.answers[question.id]);
    const legacy = validateSurveyAnswers(values);
    return legacy.ok ? JSON.stringify(legacy.data) : null;
  }

  const answers = validateAnswers(questions, raw);
  if (!answers.ok) {
    return null;
  }
  return JSON.stringify({ version: CONFIGURED_PAYLOAD_VERSION, answers: answers.answers });
}

/**
 * Decodes a decrypted payload back into answers keyed by question id.
 * Returns `null` for anything that doesn't validate against the survey, so
 * the caller can exclude it from aggregates instead of guessing.
 */
export function decodeResponsePayload(
  survey: SurveyPayloadSource,
  plaintext: string,
): Record<string, AnswerValue> | null {
  const questions = resolveSurveyQuestions(survey);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }

  if (isLegacySurvey(survey)) {
    const legacy = validateSurveyAnswers(parsed);
    if (!legacy.ok) {
      return null;
    }
    const answers: Record<string, AnswerValue> = {};
    questions.forEach((question, index) => {
      answers[question.id] = legacy.data[index];
    });
    return answers;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== CONFIGURED_PAYLOAD_VERSION) {
    return null;
  }
  const validated = validateAnswers(questions, envelope.answers);
  return validated.ok ? validated.answers : null;
}

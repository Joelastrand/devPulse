/**
 * Configurable survey question definitions (docs/features/team-survey-builder/
 * SPEC.md — "Question types", "Compatibility", "Privacy contract for free
 * text"). Pure domain logic: no Firestore, no I/O, no clock.
 *
 * Every value here is untrusted until validated by this module. Callers pass
 * raw input through `validateQuestionDefinitions` or `validateAnswers` and
 * only use the typed result.
 */

export const QUESTION_TYPES = [
  "rating",
  "single_choice",
  "multiple_choice",
  "free_text",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const MIN_QUESTIONS = 1;
export const MAX_QUESTIONS = 20;
export const MIN_CHOICE_OPTIONS = 2;
export const MAX_CHOICE_OPTIONS = 10;
export const MAX_PROMPT_LENGTH = 500;
export const MAX_OPTION_LABEL_LENGTH = 200;
export const MAX_FREE_TEXT_LENGTH = 1000;
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** Stable, opaque, server-validated identifier shape for question and option ids. */
const ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export interface ChoiceOption {
  id: string;
  label: string;
}

interface QuestionBase {
  id: string;
  prompt: string;
  required: boolean;
}

export type SurveyQuestion =
  | (QuestionBase & { type: "rating" })
  | (QuestionBase & { type: "single_choice"; options: ChoiceOption[] })
  | (QuestionBase & { type: "multiple_choice"; options: ChoiceOption[] })
  | (QuestionBase & { type: "free_text"; maxLength: number });

/** Every question-validation failure code. Runtime list so callers can recognise them. */
export const QUESTION_VALIDATION_ERRORS = [
  "invalid_questions",
  "invalid_question_count",
  "duplicate_question_id",
  "invalid_question_type",
  "invalid_question_id",
  "invalid_prompt",
  "invalid_options",
  "duplicate_option_id",
  "invalid_option_id",
  "invalid_option_label",
  "invalid_max_length",
  "free_text_must_be_optional",
] as const;
export type QuestionValidationError = (typeof QUESTION_VALIDATION_ERRORS)[number];

export type ValidateQuestionDefinitionsResult =
  | { ok: true; questions: SurveyQuestion[] }
  | { ok: false; error: QuestionValidationError };

/** A respondent's answer to one question, by its type. */
export type AnswerValue = number | string | string[];

export type ValidateAnswersResult =
  | { ok: true; answers: Record<string, AnswerValue> }
  | { ok: false; error: "invalid_answers" };

/**
 * Validates an untrusted question-definition array. Fail-closed: any invalid
 * element rejects the whole set, and the error names the first invariant that
 * failed (not the raw value), so nothing user-supplied is echoed back.
 */
export function validateQuestionDefinitions(
  input: unknown,
): ValidateQuestionDefinitionsResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: "invalid_questions" };
  }
  if (input.length < MIN_QUESTIONS || input.length > MAX_QUESTIONS) {
    return { ok: false, error: "invalid_question_count" };
  }

  const seenIds = new Set<string>();
  const questions: SurveyQuestion[] = [];

  for (const raw of input) {
    const result = validateQuestion(raw);
    if (!result.ok) {
      return result;
    }
    if (seenIds.has(result.question.id)) {
      return { ok: false, error: "duplicate_question_id" };
    }
    seenIds.add(result.question.id);
    questions.push(result.question);
  }

  return { ok: true, questions };
}

type ValidateQuestionResult =
  | { ok: true; question: SurveyQuestion }
  | { ok: false; error: QuestionValidationError };

function validateQuestion(raw: unknown): ValidateQuestionResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "invalid_questions" };
  }
  const record = raw as Record<string, unknown>;

  if (!isValidId(record.id)) {
    return { ok: false, error: "invalid_question_id" };
  }
  if (!isValidPrompt(record.prompt)) {
    return { ok: false, error: "invalid_prompt" };
  }
  if (typeof record.required !== "boolean") {
    return { ok: false, error: "invalid_questions" };
  }
  // Privacy contract (team-survey-builder SPEC — "Privacy contract for free
  // text"): free text is always optional, so a respondent can never be forced
  // to write identifying detail.
  if (record.type === "free_text" && record.required) {
    return { ok: false, error: "free_text_must_be_optional" };
  }

  const base: QuestionBase = {
    id: record.id,
    prompt: record.prompt.trim(),
    required: record.required,
  };

  switch (record.type) {
    case "rating":
      return { ok: true, question: { ...base, type: "rating" } };

    case "single_choice":
    case "multiple_choice": {
      const options = validateOptions(record.options);
      if (!options.ok) {
        return options;
      }
      return {
        ok: true,
        question: { ...base, type: record.type, options: options.options },
      };
    }

    case "free_text":
      if (
        !Number.isInteger(record.maxLength) ||
        (record.maxLength as number) < 1 ||
        (record.maxLength as number) > MAX_FREE_TEXT_LENGTH
      ) {
        return { ok: false, error: "invalid_max_length" };
      }
      return {
        ok: true,
        question: { ...base, type: "free_text", maxLength: record.maxLength as number },
      };

    default:
      return { ok: false, error: "invalid_question_type" };
  }
}

function validateOptions(
  raw: unknown,
): { ok: true; options: ChoiceOption[] } | { ok: false; error: QuestionValidationError } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "invalid_options" };
  }
  if (raw.length < MIN_CHOICE_OPTIONS || raw.length > MAX_CHOICE_OPTIONS) {
    return { ok: false, error: "invalid_options" };
  }

  const seen = new Set<string>();
  const options: ChoiceOption[] = [];
  for (const option of raw) {
    if (typeof option !== "object" || option === null) {
      return { ok: false, error: "invalid_options" };
    }
    const { id, label } = option as Record<string, unknown>;
    if (!isValidId(id)) {
      return { ok: false, error: "invalid_option_id" };
    }
    if (seen.has(id)) {
      return { ok: false, error: "duplicate_option_id" };
    }
    seen.add(id);
    if (!isValidLabel(label)) {
      return { ok: false, error: "invalid_option_label" };
    }
    options.push({ id, label: label.trim() });
  }
  return { ok: true, options };
}

/**
 * Validates one respondent's answers against a survey's question set. The
 * whole submission is rejected on any problem, with one generic error, so no
 * detail about which question failed leaks to the caller.
 */
export function validateAnswers(
  questions: readonly SurveyQuestion[],
  raw: unknown,
): ValidateAnswersResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "invalid_answers" };
  }
  const input = raw as Record<string, unknown>;
  const questionIds = new Set(questions.map((question) => question.id));

  // Unknown keys are rejected rather than ignored: a payload for a different
  // question set must not silently succeed.
  for (const key of Object.keys(input)) {
    if (!questionIds.has(key)) {
      return { ok: false, error: "invalid_answers" };
    }
  }

  const answers: Record<string, AnswerValue> = {};
  for (const question of questions) {
    const value = input[question.id];
    if (value === undefined || value === null) {
      if (question.required) {
        return { ok: false, error: "invalid_answers" };
      }
      continue;
    }
    const normalized = normalizeAnswer(question, value);
    if (normalized === null) {
      return { ok: false, error: "invalid_answers" };
    }
    if (normalized === "" && question.type === "free_text") {
      continue;
    }
    answers[question.id] = normalized;
  }

  return { ok: true, answers };
}

function normalizeAnswer(question: SurveyQuestion, value: unknown): AnswerValue | null {
  switch (question.type) {
    case "rating":
      return isRatingValue(value) ? value : null;

    case "single_choice":
      return typeof value === "string" && hasOption(question.options, value) ? value : null;

    case "multiple_choice": {
      if (!Array.isArray(value)) {
        return null;
      }
      const seen = new Set<string>();
      for (const item of value) {
        if (typeof item !== "string" || !hasOption(question.options, item) || seen.has(item)) {
          return null;
        }
        seen.add(item);
      }
      if (value.length === 0 && question.required) {
        return null;
      }
      return [...seen];
    }

    case "free_text": {
      if (typeof value !== "string") {
        return null;
      }
      const trimmed = value.trim();
      if (trimmed.length > question.maxLength) {
        return null;
      }
      // Empty text is only valid for an optional question; it is then
      // omitted from the stored answers (see `validateAnswers`).
      if (trimmed.length === 0) {
        return question.required ? null : "";
      }
      return trimmed;
    }
  }
}

function hasOption(options: readonly ChoiceOption[], id: string): boolean {
  return options.some((option) => option.id === id);
}

function isRatingValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= RATING_MIN &&
    value <= RATING_MAX
  );
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isValidPrompt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_PROMPT_LENGTH
  );
}

function isValidLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_OPTION_LABEL_LENGTH
  );
}

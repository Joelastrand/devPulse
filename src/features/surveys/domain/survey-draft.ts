import type { ChoiceOption, QuestionType, SurveyQuestion } from "./question-definitions";
import { resolveSurveyQuestions } from "./survey";

/**
 * Pure editing model for the team survey editor (team-survey-builder TSB-005).
 * The UI holds one `SurveyDraft` and applies these operations to it. Nothing
 * here is authoritative: the server re-validates every save, and these helpers
 * only keep the editor's own state well-formed, so it can't drift into shapes
 * the server would reject.
 */

export interface SurveyDraft {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  questions: SurveyQuestion[];
}

export interface DraftSource {
  title?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  questions?: SurveyQuestion[];
}

const MAX_FREE_TEXT_DEFAULT = 500;
const DEFAULT_PROMPT = "Nytt spørsmål";
const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 10;

/**
 * A short, unique id for a question or option. The prefix is a lowercase
 * letter and the random part is [a-z0-9], so the result always matches the
 * server id pattern. Uniqueness is checked against `taken`.
 */
export function generateId(prefix: string, taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = `${prefix}${Math.random().toString(36).slice(2, 10)}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${prefix}${Date.now().toString(36)}`;
}

export function draftFromSource(source: DraftSource): SurveyDraft {
  return {
    title: source.title ?? "",
    description: source.description ?? "",
    startAt: source.startAt ?? "",
    endAt: source.endAt ?? "",
    questions: source.questions ?? resolveSurveyQuestions({}),
  };
}

function defaultOptions(): ChoiceOption[] {
  const first = generateId("o", new Set());
  const second = generateId("o", new Set([first]));
  return [
    { id: first, label: "Alternativ 1" },
    { id: second, label: "Alternativ 2" },
  ];
}

/** A new question of the given type. Ids are generated and unique within `questions`. */
export function newQuestion(type: QuestionType, questions: readonly SurveyQuestion[]): SurveyQuestion {
  const taken = new Set(questions.map((question) => question.id));
  const id = generateId("q", taken);
  const base = { id, prompt: DEFAULT_PROMPT, required: type !== "free_text" };
  switch (type) {
    case "rating":
      return { ...base, type };
    case "single_choice":
    case "multiple_choice":
      return { ...base, type, options: defaultOptions() };
    case "free_text":
      return { ...base, type, required: false, maxLength: MAX_FREE_TEXT_DEFAULT };
  }
}

export function canAddQuestion(questions: readonly SurveyQuestion[]): boolean {
  return questions.length < MAX_QUESTIONS;
}

export function addQuestion(questions: readonly SurveyQuestion[], type: QuestionType): SurveyQuestion[] {
  if (!canAddQuestion(questions)) {
    return [...questions];
  }
  return [...questions, newQuestion(type, questions)];
}

export function removeQuestion(questions: readonly SurveyQuestion[], index: number): SurveyQuestion[] {
  return questions.filter((_, position) => position !== index);
}

/** Moves a question by one position. Out-of-range moves are a no-op. */
export function moveQuestion(questions: readonly SurveyQuestion[], index: number, delta: -1 | 1): SurveyQuestion[] {
  const target = index + delta;
  if (index < 0 || target < 0 || index >= questions.length || target >= questions.length) {
    return [...questions];
  }
  const next = [...questions];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function updateQuestion(
  questions: readonly SurveyQuestion[],
  index: number,
  update: (question: SurveyQuestion) => SurveyQuestion,
): SurveyQuestion[] {
  return questions.map((question, position) => (position === index ? update(question) : question));
}

/**
 * Switches a question's type while keeping its id, prompt and required flag.
 * Choice options are kept when moving between choice types, and filled in
 * when switching from another type. Free text is never required.
 */
export function changeQuestionType(question: SurveyQuestion, type: QuestionType): SurveyQuestion {
  if (question.type === type) {
    return question;
  }
  const base = { id: question.id, prompt: question.prompt, required: type === "free_text" ? false : question.required };
  switch (type) {
    case "rating":
      return { ...base, type };
    case "single_choice":
    case "multiple_choice":
      return {
        ...base,
        type,
        options: "options" in question ? question.options : defaultOptions(),
      };
    case "free_text":
      return { ...base, type, maxLength: MAX_FREE_TEXT_DEFAULT };
  }
}

export function addOption(question: SurveyQuestion): SurveyQuestion {
  if (question.type !== "single_choice" && question.type !== "multiple_choice") {
    return question;
  }
  if (question.options.length >= MAX_OPTIONS) {
    return question;
  }
  const taken = new Set(question.options.map((option) => option.id));
  const label = `Alternativ ${question.options.length + 1}`;
  return { ...question, options: [...question.options, { id: generateId("o", taken), label }] };
}

export function removeOption(question: SurveyQuestion, optionIndex: number): SurveyQuestion {
  if (question.type !== "single_choice" && question.type !== "multiple_choice") {
    return question;
  }
  return { ...question, options: question.options.filter((_, position) => position !== optionIndex) };
}

export function renameOption(question: SurveyQuestion, optionIndex: number, label: string): SurveyQuestion {
  if (question.type !== "single_choice" && question.type !== "multiple_choice") {
    return question;
  }
  return {
    ...question,
    options: question.options.map((option, position) =>
      position === optionIndex ? { ...option, label } : option,
    ),
  };
}

/**
 * The patch sent to `PATCH /api/admin/.../surveys/[surveyId]`. Empty optional
 * text becomes `null` (cleared). Question data is sent as-is; the server
 * validates it again.
 */
export function draftToPatch(draft: SurveyDraft): {
  title: string | null;
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  questions: SurveyQuestion[];
} {
  return {
    title: nullIfBlank(draft.title),
    description: nullIfBlank(draft.description),
    startAt: draft.startAt === "" ? null : toIsoOrRaw(draft.startAt),
    endAt: draft.endAt === "" ? null : toIsoOrRaw(draft.endAt),
    questions: draft.questions,
  };
}

function nullIfBlank(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

/** Converts a `datetime-local` value to an ISO string. Unparseable input is passed through for the server to reject. */
export function toIsoOrRaw(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** Formats an ISO instant for a `datetime-local` input, in the viewer's local time. */
export function toDateTimeLocal(iso: string | undefined): string {
  if (iso === undefined) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

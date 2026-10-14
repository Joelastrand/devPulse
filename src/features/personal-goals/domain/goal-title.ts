import { GOAL_TITLE_MAX, GOAL_TITLE_MIN } from "./goal-constants";

export type NormalizeGoalTitleResult = { ok: true; title: string } | { ok: false };

// Control, format, private-use, surrogate, unassigned code points and
// line/paragraph separators.
const FORBIDDEN_CODE_POINTS = /[\p{C}\p{Zl}\p{Zp}]/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const WHITESPACE_RUN = /\s+/g;

/**
 * Goal-local title contract (BR-9): NFC → trim → reject forbidden code points
 * → collapse inner whitespace runs → length in code points → require a letter
 * or digit. Deliberately not imported from the profiles feature (BR-10); a
 * parity test locks it to `normalizeDisplayName`. An inner newline or tab is
 * rejected, not turned into a space. A title is inert text (BR-11): nothing
 * here interprets HTML or Markdown.
 */
export function normalizeGoalTitle(input: unknown): NormalizeGoalTitleResult {
  if (typeof input !== "string") {
    return { ok: false };
  }
  const trimmed = input.normalize("NFC").trim();
  if (FORBIDDEN_CODE_POINTS.test(trimmed)) {
    return { ok: false };
  }
  const title = trimmed.replace(WHITESPACE_RUN, " ");
  const length = Array.from(title).length;
  if (length < GOAL_TITLE_MIN || length > GOAL_TITLE_MAX) {
    return { ok: false };
  }
  if (!LETTER_OR_NUMBER.test(title)) {
    return { ok: false };
  }
  return { ok: true, title };
}

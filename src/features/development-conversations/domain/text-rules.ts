import {
  NEXT_STEP_MAX_BYTES,
  NEXT_STEP_MAX_CODE_POINTS,
  NEXT_STEPS_MAX_ITEMS,
  NOTE_MAX_BYTES,
  TITLE_MAX_BYTES,
  TITLE_MAX_CODE_POINTS,
} from "./conversation-constants";

/**
 * Text rules for conversation free text (SPEC BR-39). Two families:
 *
 * - Single-line inert text (titles, next steps): NFC, then trim, then reject any forbidden code point, then
 *   apply the code-point and UTF-8 byte caps to the trimmed text. Both caps must hold. A line break is
 *   rejected rather than flattened.
 * - Plain-text notes: NFC only, with no trimming (BR-39 does not ask for it). LF, CR and TAB are allowed.
 *   Every other forbidden code point is rejected. Capped by UTF-8 bytes only (`NOTE_MAX_BYTES`). Stored and
 *   returned as plain text; never parsed as Markdown or HTML.
 *
 * Forbidden code points are every control, format, private-use, surrogate and unassigned code point, plus
 * line and paragraph separators (`\p{C}`, `\p{Zl}`, `\p{Zp}`). This is the same set D1 titles use. It also
 * rejects bidi overrides and zero-width joiners, which are spoofing vectors.
 *
 * Empty input is handled per field by the callers: titles and next steps must be non-empty, notes may be
 * empty (BR-20 clears).
 */

export type NormalizeTextResult = { ok: true; text: string } | { ok: false };

const FORBIDDEN_CODE_POINT = /[\p{C}\p{Zl}\p{Zp}]/u;
const NOTE_LINE_BREAKS = new Set(["\n", "\r", "\t"]);

const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** Shared single-line check: NFC, trim, forbidden code points, then the caller's code-point and byte caps. */
function normalizeSingleLine(input: unknown, maxCodePoints: number, maxBytes: number): NormalizeTextResult {
  if (typeof input !== "string") {
    return { ok: false };
  }
  const text = input.normalize("NFC").trim();
  if (FORBIDDEN_CODE_POINT.test(text)) {
    return { ok: false };
  }
  if (text.length === 0) {
    return { ok: false };
  }
  if (codePointLength(text) > maxCodePoints || utf8ByteLength(text) > maxBytes) {
    return { ok: false };
  }
  return { ok: true, text };
}

/** A conversation title: 1–100 code points and at most 400 UTF-8 bytes (BR-39). */
export function normalizeTitle(input: unknown): NormalizeTextResult {
  return normalizeSingleLine(input, TITLE_MAX_CODE_POINTS, TITLE_MAX_BYTES);
}

/** One next step: 1–200 code points and at most 800 UTF-8 bytes (BR-39). */
export function normalizeNextStep(input: unknown): NormalizeTextResult {
  return normalizeSingleLine(input, NEXT_STEP_MAX_CODE_POINTS, NEXT_STEP_MAX_BYTES);
}

/**
 * Next steps as a whole: 0–10 items, each a valid next step. Empty items are rejected, not dropped (BR-18
 * and BR-39), so the caller learns exactly which request was invalid.
 */
export function normalizeNextSteps(input: unknown): { ok: true; items: string[] } | { ok: false } {
  if (!Array.isArray(input) || input.length > NEXT_STEPS_MAX_ITEMS) {
    return { ok: false };
  }
  const items: string[] = [];
  for (const entry of input) {
    const normalized = normalizeNextStep(entry);
    if (!normalized.ok) {
      return { ok: false };
    }
    items.push(normalized.text);
  }
  return { ok: true, items };
}

/**
 * Plain-text notes: NFC only, line breaks allowed, other forbidden code points rejected, UTF-8 byte cap.
 * Empty is valid and means "cleared" (BR-20). Whitespace is preserved, because trimming notes is not in
 * BR-39.
 */
export function normalizeNote(input: unknown): NormalizeTextResult {
  if (typeof input !== "string") {
    return { ok: false };
  }
  const text = input.normalize("NFC");
  for (const char of text) {
    if (NOTE_LINE_BREAKS.has(char)) {
      continue;
    }
    if (FORBIDDEN_CODE_POINT.test(char)) {
      return { ok: false };
    }
  }
  if (utf8ByteLength(text) > NOTE_MAX_BYTES) {
    return { ok: false };
  }
  return { ok: true, text };
}

import { CONVERSATION_BODY_MAX_BYTES } from "../../../../src/features/development-conversations/domain/conversation-constants";

export type ReadConversationBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: "invalid_input" | "payload_too_large" };

const INVALID: ReadConversationBodyResult = { ok: false, error: "invalid_input" };
const TOO_LARGE: ReadConversationBodyResult = { ok: false, error: "payload_too_large" };

/** Outcome of the streamed read: the bytes, or the reason no bytes were kept. */
type BoundedBytes = { kind: "bytes"; bytes: Uint8Array } | { kind: "too_large" } | { kind: "unreadable" };

/**
 * Reads the body as bytes and stops as soon as more than {@link CONVERSATION_BODY_MAX_BYTES} have arrived, so the cap
 * holds whatever `Content-Length` claims (BR-40). The count is over bytes, so multibyte text is measured as UTF-8.
 */
async function readBoundedBytes(request: Request): Promise<BoundedBytes> {
  if (request.body === null) return { kind: "unreadable" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CONVERSATION_BODY_MAX_BYTES) {
        // The size decision is final. Cancelling the stream is best-effort cleanup, so its failure cannot change the 413.
        try {
          await reader.cancel();
        } catch {
          // Best effort only: the oversize result below stands whatever the cancellation did.
        }
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "unreadable" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "bytes", bytes };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Strict conversation body reading (SPEC BR-19, BR-40, BR-47). Order: the streamed byte cap, then UTF-8 decoding, then
 * JSON, then the object and key checks. Only structure is checked here. Field validity (title, dates, ids) belongs to the
 * operations, which own every normalisation rule. A rejected body is never returned or logged.
 */
export async function readConversationBody(request: Request, allowedKeys: ReadonlySet<string>): Promise<ReadConversationBodyResult> {
  const read = await readBoundedBytes(request);
  if (read.kind === "too_large") return TOO_LARGE;
  if (read.kind === "unreadable") return INVALID;
  return parseConversationBody(read.bytes, allowedKeys);
}

export type ReadEmptyConversationBodyResult = { ok: true } | { ok: false; error: "invalid_input" | "payload_too_large" };

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * A route that takes no body (SPEC BR-17, BR-40; TASK-024). An absent or empty body is accepted. Any other body is read
 * under the same streamed cap and must be an empty object, so any key is refused as `invalid_input` without its name.
 */
export async function readEmptyConversationBody(request: Request): Promise<ReadEmptyConversationBodyResult> {
  if (request.body === null) return { ok: true };
  const read = await readBoundedBytes(request);
  if (read.kind === "too_large") return TOO_LARGE;
  if (read.kind === "unreadable") return INVALID;
  if (read.bytes.byteLength === 0) return { ok: true };
  const parsed = parseConversationBody(read.bytes, NO_KEYS);
  return parsed.ok ? { ok: true } : parsed;
}

function parseConversationBody(bytes: Uint8Array, allowedKeys: ReadonlySet<string>): ReadConversationBodyResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return INVALID;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return INVALID;
  }
  if (!isPlainObject(parsed)) return INVALID;
  if (!Object.keys(parsed).every((key) => allowedKeys.has(key))) return INVALID;
  return { ok: true, body: parsed };
}

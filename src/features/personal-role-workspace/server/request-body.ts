import "server-only";
import { RECORD_BODY_MAX_BYTES } from "../domain/constants";

/**
 * Strict request-body reading for responsibilities and achievements (SECURITY.md PR-SI-6). The body is read as a bounded
 * stream, so the cap holds whatever `Content-Length` claims. Only structural checks happen here: size, JSON, object shape and
 * a key allow-list. Business rules belong to the domain. Owner selectors (`uid`, `ownerUid`) are unknown keys and are rejected.
 * Nothing from a rejected body is returned or logged.
 */

export type BodyResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: "invalid_request" | "payload_too_large" };

const RESPONSIBILITY_KEYS = ["title", "description", "status", "relationToRole", "startDate", "endDate", "goalIds"] as const;
const ACHIEVEMENT_KEYS = ["title", "description", "outcome", "relationToRole", "periodStart", "periodEnd", "goalIds", "responsibilityIds"] as const;

async function readBoundedText(request: Request): Promise<{ ok: true; text: string } | { ok: false; error: "invalid_request" | "payload_too_large" }> {
  if (request.body === null) return { ok: false, error: "invalid_request" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > RECORD_BODY_MAX_BYTES) {
        await reader.cancel();
        return { ok: false, error: "payload_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "invalid_request" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: "invalid_request" };
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readObject(request: Request, allowed: readonly string[]): Promise<BodyResult> {
  const text = await readBoundedText(request);
  if (!text.ok) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text);
  } catch {
    return { ok: false, error: "invalid_request" };
  }
  if (!isPlainObject(parsed)) return { ok: false, error: "invalid_request" };
  if (Object.keys(parsed).some((key) => !allowed.includes(key))) return { ok: false, error: "invalid_request" };
  return { ok: true, value: parsed };
}

/** `POST` body with the optional fields defaulted, so the domain validates one complete object. */
export async function readResponsibilityCreate(request: Request): Promise<BodyResult> {
  const body = await readObject(request, RESPONSIBILITY_KEYS);
  if (!body.ok) return body;
  return {
    ok: true,
    value: { description: null, status: "active", relationToRole: "unspecified", startDate: null, endDate: null, goalIds: [], ...body.value },
  };
}

/** `PATCH` body: any subset of the editable keys. The operation merges it with the stored content. */
export function readResponsibilityPatch(request: Request): Promise<BodyResult> {
  return readObject(request, RESPONSIBILITY_KEYS);
}

export async function readAchievementCreate(request: Request): Promise<BodyResult> {
  const body = await readObject(request, ACHIEVEMENT_KEYS);
  if (!body.ok) return body;
  return {
    ok: true,
    value: { outcome: null, relationToRole: "unspecified", periodStart: null, periodEnd: null, goalIds: [], responsibilityIds: [], ...body.value },
  };
}

export function readAchievementPatch(request: Request): Promise<BodyResult> {
  return readObject(request, ACHIEVEMENT_KEYS);
}

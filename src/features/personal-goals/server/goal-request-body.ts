import { GOAL_BODY_MAX_BYTES } from "../domain/goal-constants";
import type { CreatePersonalGoalInput } from "./create-personal-goal";
import type { UpdatePersonalGoalInput } from "./update-personal-goal";

export type ReadCreateGoalRequestResult =
  | { ok: true; input: CreatePersonalGoalInput }
  | { ok: false; error: "invalid_request" };

const INVALID: ReadCreateGoalRequestResult = { ok: false, error: "invalid_request" };

/** BR-22: the only keys a `POST` body may carry. Anything else, owner selectors included, is rejected. */
const CREATE_KEYS: ReadonlySet<string> = new Set(["title", "treeId", "targetDate"]);

/**
 * Reads the body as bytes, stopping as soon as more than {@link GOAL_BODY_MAX_BYTES} have arrived, so the cap
 * holds whatever `Content-Length` claims. Returns `undefined` for an oversize, absent or undecodable body.
 */
async function readBoundedText(request: Request): Promise<string | undefined> {
  if (request.body === null) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > GOAL_BODY_MAX_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Strict `POST /api/me/goals` body reading (BR-22). Structural checks only: body size, JSON, object, key
 * allow-list, `title` present as a string, `treeId` / `targetDate` a string or `null` (null is absent).
 * Business validity (title normalisation, date range, SkillTree existence) belongs to the operation.
 * Nothing from a rejected body is returned or logged.
 */
export async function readCreateGoalRequest(request: Request): Promise<ReadCreateGoalRequestResult> {
  const text = await readBoundedText(request);
  if (text === undefined) return INVALID;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return INVALID;
  }
  if (!isPlainObject(parsed)) return INVALID;
  if (!Object.keys(parsed).every((key) => CREATE_KEYS.has(key))) return INVALID;

  const { title, treeId, targetDate } = parsed;
  if (typeof title !== "string") return INVALID;
  if (treeId !== undefined && treeId !== null && typeof treeId !== "string") return INVALID;
  if (targetDate !== undefined && targetDate !== null && typeof targetDate !== "string") return INVALID;

  const input: CreatePersonalGoalInput = { title };
  if (typeof treeId === "string") input.treeId = treeId;
  if (typeof targetDate === "string") input.targetDate = targetDate;
  return { ok: true, input };
}

export type ReadUpdateGoalRequestResult =
  | { ok: true; input: UpdatePersonalGoalInput }
  | { ok: false; error: "invalid_request" };

/** BR-22: the only keys a `PATCH` body may carry. Anything else, owner selectors included, is rejected. */
const UPDATE_KEYS: ReadonlySet<string> = new Set(["title", "treeId", "targetDate", "status"]);

/**
 * Strict `PATCH /api/me/goals/[goalId]` body reading (BR-22). Same byte cap and JSON checks as create, then a
 * key allow-list with at least one key. Unlike create, `null` is meaningful: `treeId` / `targetDate` `null`
 * means remove and is forwarded as `null`; an absent key stays absent. `title` must be a string (a `null`
 * title is a wrong type); `status` must be exactly "active" or "completed". Business validity of title and
 * date, and SkillTree existence, belong to the operation.
 */
export async function readUpdateGoalRequest(request: Request): Promise<ReadUpdateGoalRequestResult> {
  const text = await readBoundedText(request);
  if (text === undefined) return INVALID;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return INVALID;
  }
  if (!isPlainObject(parsed)) return INVALID;
  const keys = Object.keys(parsed);
  if (keys.length === 0 || !keys.every((key) => UPDATE_KEYS.has(key))) return INVALID;

  const { title, treeId, targetDate, status } = parsed;
  if (title !== undefined && typeof title !== "string") return INVALID;
  if (treeId !== undefined && treeId !== null && typeof treeId !== "string") return INVALID;
  if (targetDate !== undefined && targetDate !== null && typeof targetDate !== "string") return INVALID;
  if (status !== undefined && status !== "active" && status !== "completed") return INVALID;

  const input: UpdatePersonalGoalInput = {};
  if (title !== undefined) input.title = title;
  if (treeId !== undefined) input.treeId = treeId;
  if (targetDate !== undefined) input.targetDate = targetDate;
  if (status !== undefined) input.status = status;
  return { ok: true, input };
}

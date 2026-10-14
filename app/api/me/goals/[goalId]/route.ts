import { NextResponse } from "next/server";
import { verifyIdToken } from "../../../../../src/features/auth/server/verify-identity";
import { GOAL_DTO_KEYS } from "../../../../../src/features/personal-goals/domain/goal-constants";
import { deletePersonalGoal } from "../../../../../src/features/personal-goals/server/delete-personal-goal";
import { readUpdateGoalRequest } from "../../../../../src/features/personal-goals/server/goal-request-body";
import { updatePersonalGoal } from "../../../../../src/features/personal-goals/server/update-personal-goal";
import type { UpdatePersonalGoalResult } from "../../../../../src/features/personal-goals/server/update-personal-goal";

const BEARER_PATTERN = /^Bearer (.+)$/;
const NO_STORE = { "Cache-Control": "no-store" };

/** BR-23: every update error the operation can return, with its status. Exhaustive by type. */
const UPDATE_ERROR_STATUS: Record<Extract<UpdatePersonalGoalResult, { ok: false }>["error"], number> = {
  goal_not_found: 404,
  invalid_title: 400,
  invalid_target_date: 400,
  skill_not_found: 404,
  // BR-64: a server-clock anomaly, nothing written; deliberately distinct from persistence_failed.
  clock_regressed: 500,
  // Also returned when the write committed and only the response-area read failed (BR-40). The route cannot
  // tell the two apart, so a 500 here does not mean "nothing was written"; an identical retry is a no-op.
  persistence_failed: 500,
};

type RouteContext = { params: Promise<{ goalId: string }> };

/**
 * One own goal (docs/features/personal-development-goals/SPEC.md — BR-5, BR-22…BR-28). Thin: the only
 * subject is the uid of the verified bearer token; the path selects a goal id and nothing else. The id is
 * handed to the operations unvalidated, because they own its addressability (BR-27a) and differ on purpose:
 * `PATCH` hides a missing or malformed goal as `goal_not_found`, `DELETE` is idempotent. `PATCH` and `DELETE` only.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const subject = await authenticate(request);
  if (!subject) return fail("unauthenticated", 401);

  const body = await readUpdateGoalRequest(request);
  if (!body.ok) return fail(body.error, 400);

  const { goalId } = await params;
  const result = await updatePersonalGoal(subject, goalId, body.input);
  if (!result.ok) return fail(result.error, UPDATE_ERROR_STATUS[result.error]);
  return json(pickGoal(result.dto), 200);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const subject = await authenticate(request);
  if (!subject) return fail("unauthenticated", 401);

  const { goalId } = await params;
  const result = await deletePersonalGoal(subject, goalId);
  if (!result.ok) return fail(result.error, 500);
  return json({ ok: true }, 200);
}

/** The verified token's uid, or `null` for a missing, malformed or unverifiable token. */
async function authenticate(request: Request): Promise<string | null> {
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  const verified = await verifyIdToken(match ? match[1] : "");
  return verified.ok ? verified.identity.uid : null;
}

/** Field-by-field allow-list of a goal DTO (SI-10), independent of what the operation returned. */
function pickGoal(goal: object): Record<string, unknown> {
  const source = goal as Record<string, unknown>;
  return Object.fromEntries(GOAL_DTO_KEYS.map((key) => [key, source[key]]));
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });
const fail = (error: string, status: number) => json({ error }, status);

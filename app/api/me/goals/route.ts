import { NextResponse } from "next/server";
import { verifyIdToken } from "../../../../src/features/auth/server/verify-identity";
import { GOAL_DTO_KEYS } from "../../../../src/features/personal-goals/domain/goal-constants";
import { createPersonalGoal } from "../../../../src/features/personal-goals/server/create-personal-goal";
import type { CreatePersonalGoalResult } from "../../../../src/features/personal-goals/server/create-personal-goal";
import { getPersonalGoals } from "../../../../src/features/personal-goals/server/get-personal-goals";
import { readCreateGoalRequest } from "../../../../src/features/personal-goals/server/goal-request-body";

const BEARER_PATTERN = /^Bearer (.+)$/;
const NO_STORE = { "Cache-Control": "no-store" };

/** BR-23: every create error the operation can return, with its status. Exhaustive by type. */
const CREATE_ERROR_STATUS: Record<Extract<CreatePersonalGoalResult, { ok: false }>["error"], number> = {
  invalid_title: 400,
  invalid_target_date: 400,
  skill_not_found: 404,
  goal_limit: 409,
  persistence_failed: 500,
};

/**
 * Own goals (docs/features/personal-development-goals/SPEC.md — BR-1, BR-5, BR-22…BR-25). Thin: the only
 * subject is the uid of the verified bearer token. No uid in path, query or body, and no team or app-admin
 * logic; a body that names an owner is rejected as an unknown key. `GET` and `POST` only.
 */
export async function GET(request: Request) {
  const subject = await authenticate(request);
  if (!subject) return fail("unauthenticated", 401);

  const result = await getPersonalGoals(subject);
  if (!result.ok) return fail("persistence_failed", 500);

  const { goals, recoveryItems, truncated, skillOptions, skillOptionsTruncated } = result.dto;
  return json(
    {
      goals: goals.map(pickGoal),
      recoveryItems: recoveryItems.map(({ goalId }) => ({ goalId })),
      truncated,
      skillOptions: skillOptions.map(({ treeId, name }) => ({ treeId, name })),
      skillOptionsTruncated,
    },
    200,
  );
}

export async function POST(request: Request) {
  const subject = await authenticate(request);
  if (!subject) return fail("unauthenticated", 401);

  const body = await readCreateGoalRequest(request);
  if (!body.ok) return fail(body.error, 400);

  const result = await createPersonalGoal(subject, body.input);
  if (!result.ok) return fail(result.error, CREATE_ERROR_STATUS[result.error]);
  return json(pickGoal(result.dto), 201);
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

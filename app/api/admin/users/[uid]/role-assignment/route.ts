import { NextResponse } from "next/server";
import {
  assignRoleToUser,
  removeRoleAssignment,
  type AssignRoleResult,
  type RemoveRoleAssignmentResult,
} from "../../../../../../src/features/role-profiles/server/role-assignments";
import { extractBearerToken, objectBody } from "../../../../../../src/features/role-profiles/server/admin-role-request";
import { authRefusalStatus, isAuthRefusal } from "../../../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * Admin-only formal role assignment for one user (`roleAssignments/{uid}`). `uid` comes only from the route; the body is
 * `{ roleId }`. `PUT` assigns or changes (one role per user); `DELETE` removes. Both refuse a self-target with `403`.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const record = objectBody(body);
  if (record === undefined) return json({ error: "invalid_request" }, 400);

  const result: AssignRoleResult = await assignRoleToUser(token, uid, record);
  if (!result.ok) return json({ error: result.error }, statusForAssignError(result.error));
  return json(result.assignment, result.created ? 201 : 200);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  const result: RemoveRoleAssignmentResult = await removeRoleAssignment(token, uid);
  if (!result.ok) return json({ error: result.error }, statusForRemoveError(result.error));
  return json({ removed: result.removed }, 200);
}

function statusForAssignError(error: Extract<AssignRoleResult, { ok: false }>["error"]): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "forbidden" || error === "self_assignment") return 403;
  if (error === "invalid_input") return 400;
  if (error === "role_not_found") return 404;
  if (error === "role_archived") return 409;
  return 500;
}

function statusForRemoveError(error: Extract<RemoveRoleAssignmentResult, { ok: false }>["error"]): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "forbidden" || error === "self_assignment") return 403;
  if (error === "invalid_input") return 400;
  return 500;
}

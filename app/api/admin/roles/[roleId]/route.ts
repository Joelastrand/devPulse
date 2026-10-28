import { NextResponse } from "next/server";
import { updateRole, type UpdateRoleResult } from "../../../../../src/features/role-profiles/server/update-role";
import {
  extractBearerToken,
  objectBody,
  pickRoleFields,
} from "../../../../../src/features/role-profiles/server/admin-role-request";

/**
 * Admin-only role edit (SPEC "Role catalog (admin)"). `roleId` comes only from the route param. A malformed role id gets
 * the same `404` as a missing role (PG-9); an archived role is `409` (PG-6); an empty body is `400`.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ roleId: string }> }) {
  const { roleId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const record = objectBody(body);
  if (record === undefined) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await updateRole(token, roleId, pickRoleFields(record));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }
  return NextResponse.json(result.role, { status: 200 });
}

function statusForError(error: Extract<UpdateRoleResult, { ok: false }>["error"]): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "invalid_input") return 400;
  if (error === "not_found" || error === "skill_not_found") return 404;
  if (error === "role_archived") return 409;
  return 500;
}

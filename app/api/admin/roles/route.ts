import { NextResponse } from "next/server";
import { createRole, type CreateRoleResult } from "../../../../src/features/role-profiles/server/create-role";
import { listRolesForAdmin, type ListRolesForAdminResult } from "../../../../src/features/role-profiles/server/list-roles-for-admin";
import {
  extractBearerToken,
  objectBody,
  pickRoleFields,
} from "../../../../src/features/role-profiles/server/admin-role-request";

/**
 * Admin-only role catalog (SPEC "Role catalog (admin)"). `GET` lists a window of roles and `POST` creates one. Kept
 * thin: authorization, validation and persistence live in the operations, and only role fields reach them.
 */
export async function GET(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  const raw = new URL(request.url).searchParams.get("includeArchived");
  const includeArchived = raw === null ? undefined : raw === "true" ? true : raw === "false" ? false : raw;

  const result = await listRolesForAdmin(token, { includeArchived });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForListError(result.error) });
  }
  return NextResponse.json({ roles: result.roles, truncated: result.truncated }, { status: 200 });
}

export async function POST(request: Request) {
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

  const result = await createRole(token, pickRoleFields(record));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForCreateError(result.error) });
  }
  return NextResponse.json(result.role, { status: 201 });
}

function statusForListError(error: Extract<ListRolesForAdminResult, { ok: false }>["error"]): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "invalid_input") return 400;
  return 500;
}

function statusForCreateError(error: Extract<CreateRoleResult, { ok: false }>["error"]): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "invalid_input") return 400;
  if (error === "skill_not_found") return 404;
  if (error === "cap_reached") return 409;
  return 500;
}

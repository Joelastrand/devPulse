import { NextResponse } from "next/server";
import { setRoleArchived, type SetRoleArchivedResult } from "../../../../../../src/features/role-profiles/server/set-role-archived";
import { extractBearerToken, objectBody } from "../../../../../../src/features/role-profiles/server/admin-role-request";

/**
 * Admin archive or restore (SPEC "Role catalog (admin)", PG-6). The body is exactly `{ archived: boolean }`; anything
 * else is `400`. Archiving and restoring are idempotent `200`s. A malformed role id is the same `404` as a missing role.
 */
export async function POST(request: Request, { params }: { params: Promise<{ roleId: string }> }) {
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

  const result = await setRoleArchived(token, roleId, record.archived);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }
  return NextResponse.json(result.role, { status: 200 });
}

function statusForError(error: Extract<SetRoleArchivedResult, { ok: false }>["error"]): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "invalid_input") return 400;
  if (error === "not_found") return 404;
  return 500;
}

import { NextResponse } from "next/server";
import { lookupRoleAssignments } from "../../../../../src/features/role-profiles/server/role-assignments";
import { extractBearerToken, objectBody } from "../../../../../src/features/role-profiles/server/admin-role-request";
import { authRefusalStatus, isAuthRefusal } from "../../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * Admin-only batch read of formal role references: body `{ uids: string[] }` (at most 100). Returns `roleId` or `null` per
 * uid. It is a `POST` only so the uid list stays out of the URL; it writes nothing.
 */
export async function POST(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const record = objectBody(body);
  if (record === undefined) return json({ error: "invalid_request" }, 400);

  const result = await lookupRoleAssignments(token, record.uids);
  if (!result.ok) return json({ error: result.error }, statusForError(result.error));
  return json({ assignments: result.assignments }, 200);
}

function statusForError(error: "unauthenticated" | "erasure_in_progress" | "auth_unavailable" | "forbidden" | "invalid_input" | "persistence_failed"): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "forbidden") return 403;
  if (error === "invalid_input") return 400;
  return 500;
}

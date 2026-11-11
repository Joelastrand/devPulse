import { NextResponse } from "next/server";
import { getOwnRoleAssignment } from "../../../../src/features/role-profiles/server/role-assignments";
import { extractBearerToken } from "../../../../src/features/role-profiles/server/admin-role-request";
import { authRefusalStatus, isAuthRefusal } from "../../../../src/features/auth/server/auth-refusal";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The signed-in person's own formal organizational role (title and description only). The subject is the verified token's
 * uid; no uid, role id or audit field is accepted or returned.
 */
export async function GET(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getOwnRoleAssignment(token);
  if (!result.ok) {
    const status = isAuthRefusal(result.error) ? authRefusalStatus(result.error) : 500;
    return NextResponse.json({ error: result.error }, { status, headers: NO_STORE });
  }
  return NextResponse.json(result.assignment, { status: 200, headers: NO_STORE });
}

import { NextResponse } from "next/server";
import { getAuthUserDetail, setAuthUserDisabled } from "../../../../../src/features/superadmins/server/user-management";
import { userManagementErrorStatus } from "../../../../../src/features/superadmins/server/user-management-http";
import { bearerTokenFrom } from "../../../../../src/features/superadmins/server/superadmin-http";

/** One account and its team memberships. The path UID is a target only; the actor is always the verified token. */
export async function GET(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const result = await getAuthUserDetail(bearerTokenFrom(request.headers.get("authorization")), uid);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: userManagementErrorStatus(result.error) });
  return NextResponse.json({ user: result.user, teams: result.teams }, { status: 200 });
}

/**
 * Disables or re-enables the account. Body: `{ "disabled": boolean, "confirm": true }`. `confirm` is required when
 * disabling; the operation refuses without it.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { disabled, confirm } = body as { disabled?: unknown; confirm?: unknown };

  const result = await setAuthUserDisabled(bearerTokenFrom(request.headers.get("authorization")), uid, disabled, confirm);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: userManagementErrorStatus(result.error) });
  return NextResponse.json({ uid: result.uid, disabled: result.disabled }, { status: 200 });
}

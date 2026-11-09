import { NextResponse } from "next/server";
import { grantSuperadmin, listSuperadmins } from "../../../../src/features/superadmins/server/superadmin-operations";
import {
  bearerTokenFrom,
  grantResponse,
  listResponse,
  superadminErrorStatus,
} from "../../../../src/features/superadmins/server/superadmin-http";

/**
 * Superadmin registry management (`/admin/superadmins`). Every request is re-authorized by the operation: a verified token,
 * and an active registry record read on that request. The grant target is an e-mail resolved through Firebase Auth; no
 * client-supplied UID is accepted as authorization or as a target.
 */
export async function GET(request: Request) {
  const result = await listSuperadmins(bearerTokenFrom(request.headers.get("authorization")));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: superadminErrorStatus(result.error) });
  return NextResponse.json(listResponse(result), { status: 200 });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await grantSuperadmin(bearerTokenFrom(request.headers.get("authorization")), (body as { email?: unknown }).email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: superadminErrorStatus(result.error) });
  return NextResponse.json(grantResponse(result), { status: 200 });
}

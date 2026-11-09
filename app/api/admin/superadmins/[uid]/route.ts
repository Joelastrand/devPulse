import { NextResponse } from "next/server";
import { revokeSuperadmin } from "../../../../../src/features/superadmins/server/superadmin-operations";
import {
  bearerTokenFrom,
  revokeResponse,
  superadminErrorStatus,
} from "../../../../../src/features/superadmins/server/superadmin-http";

/** Revokes one superadmin by UID (the path param is the target only; the actor is always the verified token). */
export async function DELETE(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const result = await revokeSuperadmin(bearerTokenFrom(request.headers.get("authorization")), uid);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: superadminErrorStatus(result.error) });
  return NextResponse.json(revokeResponse(result), { status: 200 });
}

import { NextResponse } from "next/server";
import { getOwnAdminStatus } from "../../../src/features/teams/server/get-own-admin-status";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Own-identity status endpoint (docs/features/product-ux-shell/SPEC.md —
 * BR-5 server half, TASK-004). Returns only the caller's own `isAdmin`
 * boolean — never the allow-list, another identity's status, or any team/
 * result data. Kept thin — authorization lives entirely in
 * `getOwnAdminStatus`. Purely additive: not wired into `SiteHeader` yet
 * (TASK-005's job).
 */
export async function GET(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getOwnAdminStatus(token);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  return NextResponse.json({ isAdmin: result.isAdmin }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

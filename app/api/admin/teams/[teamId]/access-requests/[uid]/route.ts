import { NextResponse } from "next/server";
import { approveAccessRequest } from "../../../../../../../src/features/teams/server/approve-access-request";
import { rejectAccessRequest } from "../../../../../../../src/features/teams/server/reject-access-request";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only access-request resolution endpoint: `PATCH` approves or
 * rejects one pending request, selected by `{status: "approved" |
 * "rejected"}` in the body — mirroring the existing team-status PATCH
 * precedent (`app/api/admin/teams/[teamId]/route.ts`). Kept thin —
 * authorization and the transactional state transition live in
 * `approveAccessRequest`/`rejectAccessRequest`
 * (`.claude/rules/nextjs-react.md`). `teamId`/`uid` come from the URL path
 * but are never trusted as authorization evidence on their own; both
 * operations re-verify the caller is an app admin on every call.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string; uid: string }> },
) {
  const { teamId, uid } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const status =
    typeof body === "object" && body !== null && "status" in body
      ? (body as { status: unknown }).status
      : undefined;

  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const result =
    status === "approved"
      ? await approveAccessRequest(token, uid, teamId)
      : await rejectAccessRequest(token, uid, teamId);

  if (!result.ok) {
    const httpStatus =
      result.error === "unauthenticated"
        ? 401
        : result.error === "forbidden"
          ? 403
          : 500;
    return NextResponse.json({ error: result.error }, { status: httpStatus });
  }

  return NextResponse.json({ outcome: result.outcome }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

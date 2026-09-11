import { NextResponse } from "next/server";
import { setTeamStatus } from "../../../../../src/features/teams/server/set-team-status";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only team status endpoint: `PATCH` disables or re-enables one team
 * by its opaque `teamId`. Kept thin — authorization and persistence live
 * in `setTeamStatus` (`.claude/rules/nextjs-react.md`). `teamId` comes
 * from the URL path but is never trusted as authorization evidence on its
 * own; `setTeamStatus` re-verifies the caller is an app admin on every
 * call.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
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

  if (status !== "active" && status !== "disabled") {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const result = await setTeamStatus(token, teamId, status);

  if (!result.ok) {
    const httpStatus =
      result.error === "unauthenticated"
        ? 401
        : result.error === "forbidden"
          ? 403
          : 500;
    return NextResponse.json({ error: result.error }, { status: httpStatus });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

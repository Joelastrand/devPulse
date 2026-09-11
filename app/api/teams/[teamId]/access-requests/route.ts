import { NextResponse } from "next/server";
import { createAccessRequest } from "../../../../../src/features/teams/server/create-access-request";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Non-admin, authenticated access-request endpoint
 * (docs/features/team-management/SPEC.md — BR-23). Kept thin —
 * authorization and persistence live in `createAccessRequest`
 * (`.claude/rules/nextjs-react.md`). `teamId` comes from the URL path but
 * is never trusted as authorization evidence on its own; identity comes
 * only from the verified bearer token.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await createAccessRequest(token, teamId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
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

function statusForError(
  error: "unauthenticated" | "unverified" | "team_disabled" | "read_failed" | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "unverified" || error === "team_disabled") return 400;
  return 500;
}

import { NextResponse } from "next/server";
import { cancelInvitation } from "../../../../../../src/features/teams/server/cancel-invitation";
import { createInvitation } from "../../../../../../src/features/teams/server/create-invitation";
import { listTeamInvitations } from "../../../../../../src/features/teams/server/list-team-invitations";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only team invitation endpoint: `GET` lists pending invitations,
 * `POST` invites an email, `DELETE` cancels a pending invitation. Kept
 * thin — authorization and persistence live in `listTeamInvitations`/
 * `createInvitation`/`cancelInvitation` (`.claude/rules/nextjs-react.md`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeamInvitations(token, teamId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ invitations: result.invitations }, { status: 200 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const email = await readEmailFromBody(request);

  if (email === undefined) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await createInvitation(token, teamId, email);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ outcome: result.outcome }, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const email = await readEmailFromBody(request);

  if (email === undefined) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await cancelInvitation(token, teamId, email);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

async function readEmailFromBody(request: Request): Promise<unknown> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return undefined;
  }

  return typeof body === "object" && body !== null && "email" in body
    ? (body as { email: unknown }).email
    : undefined;
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForError(
  error:
    | "unauthenticated"
    | "forbidden"
    | "invalid_email"
    | "team_not_found"
    | "team_disabled"
    | "lookup_failed"
    | "persistence_failed"
    | "read_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "invalid_email" || error === "team_disabled") return 400;
  if (error === "team_not_found") return 404;
  return 500;
}

import { NextResponse } from "next/server";
import { listTeamChallengesForMember } from "../../../../../src/features/challenges/server/list-team-challenges";
import { submitChallenge } from "../../../../../src/features/challenges/server/submit-challenge";

const BEARER_PATTERN = /^Bearer (.+)$/;

const SUBMIT_ERROR_STATUS: Record<string, number> = {
  sign_in_required: 401,
  invalid_input: 400,
  forbidden: 403,
  team_not_found: 404,
  team_disabled: 400,
  encryption_failed: 500,
  persistence_failed: 500,
};

/**
 * `/teams/[teamId]`'s member-facing challenge endpoints
 * (docs/features/anonymous-challenges/SPEC.md — TASK-005). `GET` always
 * delegates to `listTeamChallengesForMember` — **never**
 * `listTeamChallengesForAdmin`, even for a caller who happens to be an app
 * admin, since this route always serves the team page's member-scoped view
 * (TASK-006 owns a genuinely separate admin route). Both handlers are thin:
 * `teamId` comes from the URL path but is never trusted as authorization
 * evidence on its own — every authorization/lifecycle/encryption decision
 * lives in the delegated server operation, never here
 * (`.claude/rules/nextjs-react.md`, `.claude/rules/security.md`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeamChallengesForMember(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated" ? 401 : result.error === "forbidden" ? 403 : 500;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json({ status: "ok", challenges: result.challenges }, { status: 200 });
}

/**
 * Submits a new challenge for `teamId`. Accepts only a `text` field from
 * the request body — no `teamId` override, no submitter identity, no
 * status/lifecycle field of any kind (BR-2, BR-33) — identity and team
 * eligibility are derived entirely server-side by `submitChallenge`. Never
 * echoes the submitted text, a generated `challengeId`, or any Firestore
 * error detail back to the caller.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const text =
    typeof body === "object" && body !== null && "text" in body
      ? (body as { text: unknown }).text
      : undefined;

  const result = await submitChallenge(token, teamId, text);

  if (!result.ok) {
    const status = SUBMIT_ERROR_STATUS[result.error] ?? 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

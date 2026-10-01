import { NextResponse } from "next/server";
import { removeTeamMember } from "../../../../../../../src/features/teams/server/remove-team-member";
import { setTeamMemberRole } from "../../../../../../../src/features/teams/server/set-team-member-role";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only team member removal endpoint. Kept thin — authorization and
 * persistence live in `removeTeamMember`
 * (`.claude/rules/nextjs-react.md`). `teamId`/`uid` come from the URL path
 * but are never trusted as authorization evidence on their own;
 * `removeTeamMember` re-verifies the caller is an app admin on every call.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; uid: string }> },
) {
  const { teamId, uid } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await removeTeamMember(token, teamId, uid);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated"
        ? 401
        : result.error === "forbidden"
          ? 403
          : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * Admin-only team-role endpoint (docs/features/member-identity-and-team-roles/
 * SPEC.md — BR-18). Kept thin — authorization, the active-team gate and
 * persistence live in `setTeamMemberRole`. `teamId`/`uid` come from the URL
 * path but are never authorization evidence; the body is accepted only as
 * exactly `{role}` (malformed JSON, a non-object body, a missing `role` key
 * or any extra key is rejected before the operation runs), and the role
 * value itself is validated by the operation. `DELETE` above is unchanged.
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

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "role") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await setTeamMemberRole(token, teamId, uid, record.role);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForRoleError(result.error) });
  }

  return NextResponse.json({ ok: true, role: result.role }, { status: 200 });
}

/** `team_disabled` is 400, matching the other admin routes that gate a write on team status (invitations, skill tracking). */
function statusForRoleError(
  error: "unauthenticated" | "forbidden" | "invalid_input" | "not_a_member" | "team_disabled" | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "invalid_input" || error === "team_disabled") return 400;
  if (error === "not_a_member") return 404;
  return 500;
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

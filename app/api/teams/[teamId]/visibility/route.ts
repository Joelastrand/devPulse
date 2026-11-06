import { NextResponse } from "next/server";
import { readTeamVisibilitySettings, setTeamVisibility } from "../../../../../src/features/teams/server/team-visibility";
import { authRefusalStatus, isAuthRefusal } from "../../../../../src/features/auth/server/auth-refusal";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Team visibility settings (docs/features/teamadmin-and-team-visibility/SPEC.md). `GET` returns the current visibility
 * and whether the caller may change it, for members and superadmins only. `PUT` accepts exactly `{visibility}`; the
 * authorization decision lives in `setTeamVisibility`, and the caller's role is never read from the request.
 */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const result = await readTeamVisibilitySettings(extractBearerToken(request.headers.get("authorization")), teamId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusFor(result.error) });
  }
  return NextResponse.json(
    { status: "ok", visibility: result.visibility, canAdminister: result.canAdminister },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
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
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "visibility") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await setTeamVisibility(token, teamId, (body as Record<string, unknown>).visibility);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusFor(result.error) });
  }
  return NextResponse.json({ ok: true, visibility: result.visibility, changed: result.changed }, { status: 200 });
}

function statusFor(error: string): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  if (error === "invalid_input" || error === "team_disabled") return 400;
  if (error === "forbidden") return 403;
  if (error === "not_found") return 404;
  return 500;
}

function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

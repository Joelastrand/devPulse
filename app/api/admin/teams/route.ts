import { NextResponse } from "next/server";
import { createTeam } from "../../../../src/features/teams/server/create-team";
import { listTeams } from "../../../../src/features/teams/server/list-teams";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only team collection endpoint: `GET` lists every team (including
 * disabled ones), `POST` creates a new `active` team. Kept thin —
 * authorization and persistence live in `listTeams`/`createTeam`
 * (`.claude/rules/nextjs-react.md`).
 */
export async function GET(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await listTeams(token);

  if (!result.ok) {
    const status = statusForAdminError(result.error);
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ teams: result.teams }, { status: 200 });
}

export async function POST(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const name =
    typeof body === "object" && body !== null && "name" in body
      ? (body as { name: unknown }).name
      : undefined;

  const result = await createTeam(token, name);

  if (!result.ok) {
    const status =
      result.error === "invalid_name" ? 400 : statusForAdminError(result.error);
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ teamId: result.teamId }, { status: 201 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForAdminError(
  error: "unauthenticated" | "forbidden" | "persistence_failed" | "read_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  return 500;
}

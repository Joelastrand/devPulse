import { NextResponse } from "next/server";
import { seedLegacyTeams } from "../../../../../src/features/teams/server/seed-legacy-teams";
import { authRefusalStatus, isAuthRefusal } from "../../../../../src/features/auth/server/auth-refusal";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only, one-time (safe-to-repeat) seed endpoint for the four legacy
 * team ids (`LEGACY_TEAM_SEEDS`, docs/features/team-management/SPEC.md —
 * TASK-006). Never invoked automatically by any request path; an app
 * admin triggers it explicitly. Kept thin — authorization, idempotency,
 * and persistence live in `seedLegacyTeams`
 * (`.claude/rules/nextjs-react.md`).
 */
export async function POST(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await seedLegacyTeams(token);

  if (!result.ok) {
    const status = isAuthRefusal(result.error) ? authRefusalStatus(result.error) : 403;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ outcomes: result.outcomes }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

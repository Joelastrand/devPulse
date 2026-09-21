import { NextResponse } from "next/server";
import { getOrgSkillProgressOverview } from "../../../../../src/features/skill-trees/server/get-org-skill-progress-overview";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only cross-team skill-progress overview endpoint (docs/features/
 * org-skill-progress-overview/SPEC.md — TASK-002, "API/DTO contracts").
 * `GET`-only — no query string or body input exists for this route to parse.
 * Kept thin: extracts the bearer token, calls `getOrgSkillProgressOverview`,
 * and maps its result to the approved HTTP contract. Authorization,
 * validation, and the minimized DTO shape all live entirely in
 * `getOrgSkillProgressOverview`; this route duplicates none of that decision
 * logic (`.claude/rules/nextjs-react.md`).
 */
export async function GET(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getOrgSkillProgressOverview(token);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ trees: result.trees }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForError(error: "unauthenticated" | "forbidden" | "read_failed"): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  return 500;
}

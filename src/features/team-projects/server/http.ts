import "server-only";
import { NextResponse } from "next/server";
import { authRefusalStatus, isAuthRefusal } from "../../auth/server/auth-refusal";
import type { WriteTeamProjectResult } from "./write-team-project";
import type { WriteProjectParticipationResult } from "./write-project-participation";

const BEARER_PATTERN = /^Bearer (.+)$/;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Bearer token from an Authorization header, or `""` (refused as unauthenticated by the auth layer). */
export function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

/** Route-path project ids are opaque but must be a single, bounded Firestore document id segment. */
export function isValidProjectIdSegment(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value);
}

/** Unparsable JSON yields `undefined`, which the gateway refuses as `invalid_request`. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Public error code → HTTP status for team project operations. Codes only, never raw error text. */
const TEAM_PROJECT_STATUS: Record<string, number> = {
  team_disabled: 400,
  invalid_request: 400,
  invalid_input: 400,
  not_found: 404,
  project_archived: 409,
  participation_archived: 409,
  invalid_member: 400,
  limit_reached: 409,
  forbidden: 403,
  read_failed: 500,
  persistence_failed: 500,
};

export function teamProjectErrorStatus(error: string): number {
  if (isAuthRefusal(error)) return authRefusalStatus(error);
  return TEAM_PROJECT_STATUS[error] ?? 500;
}

/** Shared write response: codes and validation issue names only, never raw error text. */
export function teamProjectWriteResponse(result: WriteTeamProjectResult, successStatus: number): NextResponse {
  if (!result.ok) {
    if (result.error === "invalid_input") {
      return NextResponse.json({ error: "invalid_input", issues: result.issues }, { status: 400 });
    }
    return NextResponse.json({ error: result.error }, { status: teamProjectErrorStatus(result.error) });
  }
  return NextResponse.json({ project: result.project }, { status: successStatus });
}

/** Participation write response: codes, validation issue names and the allow-listed view only. */
export function participationWriteResponse(result: WriteProjectParticipationResult, successStatus: number): NextResponse {
  if (!result.ok) {
    if (result.error === "invalid_input") {
      return NextResponse.json({ error: "invalid_input", issues: result.issues }, { status: 400 });
    }
    return NextResponse.json({ error: result.error }, { status: teamProjectErrorStatus(result.error) });
  }
  return NextResponse.json({ participation: result.participation }, { status: successStatus });
}

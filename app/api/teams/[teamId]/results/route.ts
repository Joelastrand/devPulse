import { NextResponse } from "next/server";
import {
  getTeamSurveyResults,
  type SurveyResultEntry,
} from "../../../../../src/features/results/server/get-team-survey-results";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Protected, per-team survey-instance results/history endpoint
 * (docs/features/managed-surveys/SPEC.md — TASK-012). `teamId` comes from
 * the URL path but is never trusted as authorization evidence on its own:
 * `getTeamSurveyResults` always re-derives access via `authorizeTeamAccess`
 * before any protected data is read. Kept thin; orchestration,
 * threshold/suppression, and `closedAt` backfill logic all live in
 * `getTeamSurveyResults` (TASK-011). Replaces this same route's previous
 * calendar-period-scoped `getTeamResults`, retired by TASK-014
 * (docs/features/managed-surveys/SPEC.md).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const { teamId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getTeamSurveyResults(token, teamId);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated"
        ? 401
        : result.error === "forbidden"
          ? 403
          : 500;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json(
    {
      status: "ok",
      teamId: result.teamId,
      results: result.results.map(toResultPayload),
    },
    { status: 200 },
  );
}

/** Serializes one `SurveyResultEntry` for JSON transport — `date` (a `Date`) becomes an ISO string; every other field is passed through unchanged. */
function toResultPayload(entry: SurveyResultEntry) {
  const base = {
    surveyId: entry.surveyId,
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    date: entry.date.toISOString(),
    minimumResponses: entry.minimumResponses,
  };

  return entry.status === "published"
    ? { ...base, status: "published" as const, mean: entry.mean, count: entry.count }
    : { ...base, status: "insufficient" as const };
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

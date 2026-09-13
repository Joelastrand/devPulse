import { NextResponse } from "next/server";
import { closeSurvey } from "../../../../../../../../src/features/surveys/server/close-survey";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Admin-only survey-close endpoint (docs/features/managed-surveys/SPEC.md —
 * BR-7). Kept thin — authorization, idempotency, and the
 * `teamSurveyState` cleanup all live in `closeSurvey`
 * (`.claude/rules/nextjs-react.md`). This route's own `teamId` path segment
 * is not passed to `closeSurvey` — by design (see `close-survey.ts`'s own
 * doc comment): `closeSurvey` takes no `teamId` parameter at all and
 * derives it solely from the fetched, validated survey record, since every
 * app admin already manages every team's surveys (no team-level admin
 * role) and there is no request-body `teamId` value this route could ever
 * mistakenly substitute in its place.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string; surveyId: string }> },
) {
  const { surveyId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await closeSurvey(token, surveyId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

function statusForError(
  error: "unauthenticated" | "forbidden" | "survey_not_found" | "not_open" | "persistence_failed",
): number {
  if (error === "unauthenticated") return 401;
  if (error === "forbidden") return 403;
  if (error === "survey_not_found") return 404;
  if (error === "not_open") return 409;
  return 500;
}

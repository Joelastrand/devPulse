import { NextResponse } from "next/server";
import { submitPulseSurvey } from "../../../src/features/pulse-survey/server/submit-pulse-survey";

/**
 * Public, unauthenticated pulse survey submission endpoint. Kept thin —
 * validation, encryption, and persistence live in the feature's server
 * operation (`submitPulseSurvey`).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await submitPulseSurvey(body);

  if (!result.ok) {
    const status =
      result.error === "persistence_failed" ||
      result.error === "encryption_failed"
        ? 500
        : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

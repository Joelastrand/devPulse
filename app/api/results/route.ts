import { NextResponse } from "next/server";
import { getDashboard } from "../../../src/features/results/server/get-dashboard";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Protected dashboard/trend endpoint. The Firebase ID token is the only
 * externally-influenced input this route reads (from the `Authorization`
 * header) — team and period selection are never taken from a query
 * parameter, header, or body value (BR-6/BR-10). Kept thin; orchestration
 * lives in `getDashboard`.
 */
export async function GET(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  const result = await getDashboard(token);

  if (!result.ok) {
    const status =
      result.error === "unauthenticated"
        ? 401
        : result.error === "read_failed"
          ? 500
          : 200;
    return NextResponse.json({ status: result.error }, { status });
  }

  return NextResponse.json(
    {
      status: "ok",
      teamId: result.teamId,
      current: result.current,
      trend: result.trend,
    },
    { status: 200 },
  );
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

import { NextResponse } from "next/server";
import { getProductionStartErasureDeps } from "../../../../src/features/account-erasure/server/production-erasure";
import {
  isBodyTooLarge,
  readStartErasureBody,
  startErasureResponse,
} from "../../../../src/features/account-erasure/server/start-erasure-http";

/**
 * `POST /api/me/erasure`: start or resume the caller's own erasure (TASK-013). The body is `{confirmation}` to start, or
 * empty to resume. There is no uid in the path, query, or body; the subject is the verified token. Logic and the response
 * contract live in `start-erasure-http.ts` and `start-erasure.ts`. Only this file exports the HTTP method.
 */
export async function POST(request: Request) {
  if (isBodyTooLarge(request.headers.get("content-length"))) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const text = await request.text();
  const parsed = readStartErasureBody(text);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const response = await startErasureResponse(
    request.headers.get("authorization"),
    parsed.body,
    getProductionStartErasureDeps(),
  );
  return NextResponse.json(response.body, { status: response.status });
}

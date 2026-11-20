import { NextResponse } from "next/server";
import { authRefusalStatus } from "../../../../../src/features/auth/server/auth-refusal";
import { defaultColleagueListDeps, listEligibleColleagues } from "../../../../../src/features/development-conversations/server/list-eligible-colleagues";
import { verifiedSubject } from "../_auth";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The colleagues the caller may invite (A2.1 revised, SPEC BR-9). Owner-only by construction: the only subject is the verified
 * token's uid, and no request value selects a person or a team. The response carries an opaque membership reference and a
 * display name, or `null`, and nothing else. `truncated` is set when a bound was reached, so a partial list is never silent.
 */
export async function GET(request: Request) {
  const verified = await verifiedSubject(request);
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: authRefusalStatus(verified.error), headers: NO_STORE });

  const listed = await listEligibleColleagues(verified.uid, defaultColleagueListDeps());
  if (!listed.ok) return NextResponse.json({ error: "persistence_failed" }, { status: 500, headers: NO_STORE });

  return NextResponse.json({ colleagues: listed.colleagues, truncated: listed.truncated }, { status: 200, headers: NO_STORE });
}

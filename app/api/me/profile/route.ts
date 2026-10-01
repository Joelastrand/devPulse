import { NextResponse } from "next/server";
import { deleteOwnProfile } from "../../../../src/features/profiles/server/delete-own-profile";
import { getOwnProfile } from "../../../../src/features/profiles/server/get-own-profile";
import { setOwnProfile } from "../../../../src/features/profiles/server/set-own-profile";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Own-profile endpoints (docs/features/member-identity-and-team-roles/SPEC.md
 * — BR-1 through BR-3). Kept thin: authentication, validation and
 * persistence live in the delegated server operations
 * (`.claude/rules/nextjs-react.md`). There is deliberately no `uid` in the
 * path, query or body — the subject is always the verified token's own
 * identity — and `PUT` accepts exactly `{displayName}`; any other key, a
 * non-object body, or malformed JSON is rejected before the operation runs.
 */
export async function GET(request: Request) {
  const result = await getOwnProfile(extractBearerToken(request.headers.get("authorization")));

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusFor(result.error) });
  }

  return NextResponse.json({ displayName: result.displayName }, { status: 200 });
}

export async function PUT(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "displayName") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await setOwnProfile(token, record.displayName);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusFor(result.error) });
  }

  return NextResponse.json({ displayName: result.displayName }, { status: 200 });
}

export async function DELETE(request: Request) {
  const result = await deleteOwnProfile(extractBearerToken(request.headers.get("authorization")));

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusFor(result.error) });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

function statusFor(error: "unauthenticated" | "invalid_input" | "persistence_failed"): number {
  if (error === "unauthenticated") return 401;
  if (error === "invalid_input") return 400;
  return 500;
}

function extractBearerToken(header: string | null): string {
  if (!header) {
    return "";
  }

  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : "";
}

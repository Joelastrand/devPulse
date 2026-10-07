import { NextResponse } from "next/server";
import { getOwnSkillContribution } from "../../../../../src/features/team-skills/server/get-own-skill-contribution";
import { setOwnSkillContribution } from "../../../../../src/features/team-skills/server/set-own-skill-contribution";
import { withdrawOwnSkillContribution } from "../../../../../src/features/team-skills/server/withdraw-own-skill-contribution";

const BEARER_PATTERN = /^Bearer (.+)$/;

const STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_input: 400,
  notice_outdated: 409,
  team_disabled: 409,
  persistence_failed: 500,
};

type RouteContext = { params: Promise<{ teamId: string }> };

function bearerToken(request: Request): string {
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  return match ? match[1] : "";
}

/**
 * The caller's own skill participation (SPEC — BR-9). Thin delegates; the
 * subject is the verified token's uid, `teamId` comes from the path only.
 * Responses are built field by field: never the consent timestamp, another member's
 * state, or any membership field. Only GET, PUT and DELETE are exported.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const { teamId } = await params;
  const result = await getOwnSkillContribution(bearerToken(request), teamId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 });
  return NextResponse.json({ contributing: result.contributing, canOptIn: result.canOptIn }, { status: 200 });
}

/** Opt in. Unparsable JSON is passed on as `undefined` so it is judged only after authorization. */
export async function PUT(request: Request, { params }: RouteContext) {
  const { teamId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const result = await setOwnSkillContribution(bearerToken(request), teamId, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 });
  return NextResponse.json({ contributing: true }, { status: 200 });
}

/** Withdraw (idempotent). No body is read. */
export async function DELETE(request: Request, { params }: RouteContext) {
  const { teamId } = await params;
  const result = await withdrawOwnSkillContribution(bearerToken(request), teamId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 });
  return NextResponse.json({ contributing: false }, { status: 200 });
}

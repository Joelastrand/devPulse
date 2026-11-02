import { NextResponse } from "next/server";
import { verifyIdToken } from "../../../src/features/auth/server/verify-identity";
import { listActiveRolesForPerson } from "../../../src/features/role-profiles/server/list-active-roles";
import { authRefusalFor, authRefusalStatus } from "../../../src/features/auth/server/auth-refusal";

const BEARER_PATTERN = /^Bearer (.+)$/;
/** PG-8: the person-facing role DTO allow-list, applied again here independently of the operation. */
const ROLE_DTO_KEYS = ["roleId", "name", "description", "selectable", "expectations"] as const;

/**
 * Active role catalog for any signed-in person (SPEC "Role catalog (person, read-only)", BR-6). No admin requirement and
 * no parameters: the caller is only checked to be signed in, and the response does not depend on who asks.
 */
export async function GET(request: Request) {
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  const verified = await verifyIdToken(match ? match[1] : "");
  if (!verified.ok) {
    const refusal = authRefusalFor(verified);
    return NextResponse.json({ error: refusal }, { status: authRefusalStatus(refusal) });
  }

  const result = await listActiveRolesForPerson();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(
    {
      roles: result.roles.map((role) => Object.fromEntries(ROLE_DTO_KEYS.map((key) => [key, role[key]]))),
      truncated: result.truncated,
    },
    { status: 200 },
  );
}

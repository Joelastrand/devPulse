import { NextResponse } from "next/server";
import { verifyIdToken } from "../../../../src/features/auth/server/verify-identity";
import { clearOwnRoleTarget } from "../../../../src/features/role-profiles/server/clear-own-role-target";
import { getOwnRoleTarget } from "../../../../src/features/role-profiles/server/get-own-role-target";
import { readSetRoleTargetRequest } from "../../../../src/features/role-profiles/server/role-target-request-body";
import { setOwnRoleTarget } from "../../../../src/features/role-profiles/server/set-own-role-target";

const BEARER_PATTERN = /^Bearer (.+)$/;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The owner's target role (SPEC API "Personal target role (owner)"). The only subject is the uid of the verified bearer
 * token: no uid in the path, query, body or response (BR-10). Responses are never cached.
 */
async function authenticate(request: Request): Promise<string | null> {
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  const verified = await verifyIdToken(match ? match[1] : "");
  return verified.ok ? verified.identity.uid : null;
}

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const uid = await authenticate(request);
  if (!uid) return fail("unauthenticated", 401);

  try {
    return NextResponse.json(await getOwnRoleTarget(uid), { status: 200, headers: NO_STORE });
  } catch {
    return fail("persistence_failed", 500);
  }
}

export async function PUT(request: Request) {
  const uid = await authenticate(request);
  if (!uid) return fail("unauthenticated", 401);

  const body = await readSetRoleTargetRequest(request);
  if (!body.ok) return fail("invalid_request", 400);

  try {
    const result = await setOwnRoleTarget(uid, body.roleId);
    if (!result.ok) {
      return fail(result.error, result.error === "not_found" ? 404 : 409);
    }
    // The response is the status read after the committed write, so it reflects the stored target.
    return NextResponse.json(await getOwnRoleTarget(uid), { status: 200, headers: NO_STORE });
  } catch {
    return fail("persistence_failed", 500);
  }
}

export async function DELETE(request: Request) {
  const uid = await authenticate(request);
  if (!uid) return fail("unauthenticated", 401);

  try {
    await clearOwnRoleTarget(uid);
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch {
    return fail("persistence_failed", 500);
  }
}

import { NextResponse } from "next/server";
import { setSystemFavorite } from "../../../../../../src/features/team-systems/server/system-favorites";
import { extractBearerToken, WRITE_STATUS } from "../../../../../../src/features/team-systems/server/http";

/**
 * Sets the caller's favorite state for one system (Phase 2F.1). The body names the desired state, `{ "favorite": boolean }`,
 * so the operation is idempotent: repeating it has no further effect. Both ids come from the path. The caller is the verified
 * token's subject, never a client-supplied uid. No DELETE method is exported: removal is `favorite: false`.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ teamId: string; systemId: string }> },
) {
  const { teamId, systemId } = await params;
  const token = extractBearerToken(request.headers.get("authorization"));
  const favorite = await readFavoriteBody(request);
  if (favorite === null) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await setSystemFavorite(token, teamId, systemId, favorite);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: WRITE_STATUS[result.error] ?? 500 });
  }
  return NextResponse.json({ favorite: result.favorite }, { status: 200 });
}

/** The body must be exactly `{ "favorite": boolean }`. Anything else is `null` (invalid request). */
async function readFavoriteBody(request: Request): Promise<boolean | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "favorite") return null;
  const value = (body as Record<string, unknown>).favorite;
  return typeof value === "boolean" ? value : null;
}

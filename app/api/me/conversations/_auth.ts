import { verifyIdToken } from "../../../../src/features/auth/server/verify-identity";

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * The verified token's uid, or `null` for a missing, malformed or unverifiable token (SPEC D2-SI-1). The only subject any
 * conversation route uses. A request-supplied uid, owner or participant value is never read.
 */
export async function verifiedSubject(request: Request): Promise<string | null> {
  const match = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "");
  const verified = await verifyIdToken(match ? match[1] : "");
  return verified.ok ? verified.identity.uid : null;
}

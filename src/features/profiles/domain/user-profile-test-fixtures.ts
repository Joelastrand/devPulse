import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import { toPersistedUserProfile } from "./user-profile-content-codec";

/**
 * Test-only helper: a profile fixture as stored (display name sealed). Input that is not shaped like a profile with a string
 * display name is returned unchanged, so the operation under test refuses it as it would refuse any malformed document.
 */
export function sealedProfileFixture(uid: string, plain: unknown): unknown {
  if (typeof plain !== "object" || plain === null) return plain;
  const candidate = plain as Record<string, unknown>;
  if (typeof candidate.displayName !== "string") return plain;
  if (process.env.ENCRYPTION_KEY === undefined) vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  return toPersistedUserProfile(uid, candidate as Record<string, unknown> & { displayName: string });
}

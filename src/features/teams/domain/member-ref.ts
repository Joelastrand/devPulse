import { randomBytes } from "node:crypto";

/**
 * Opaque, team-scoped handle of one team membership (docs/features/
 * team-skill-planning/SPEC.md — "Opaque member reference"): 128 bits of
 * CSPRNG output encoded as 26 lowercase Crockford base32 characters. It is
 * never derived from a uid, e-mail, team id or membership document id, and it
 * is never authorization evidence — it only names a membership once the
 * caller has been authorized by other means.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const MEMBER_REF_PATTERN = /^[0-9a-hjkmnp-tv-z]{26}$/;
const BYTES = 16;

/** Generates a fresh member reference. Takes no input on purpose. */
export function generateMemberRef(): string {
  const bytes = randomBytes(BYTES);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) {
    // 128 = 25 * 5 + 3: the final character carries 3 bits, zero-padded.
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function isMemberRef(value: unknown): value is string {
  return typeof value === "string" && MEMBER_REF_PATTERN.test(value);
}

/**
 * The member reference stored on a raw `teamMemberships` document, or `null`
 * for a legacy membership that has none (or a malformed one). Absence is never
 * papered over with a fabricated value.
 */
export function memberRefOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const ref = (data as Record<string, unknown>).memberRef;
  return isMemberRef(ref) ? ref : null;
}

/**
 * Resolves `(teamId, ref)` against an already-read list of raw memberships
 * (the team's own memberships; no two-field Firestore query). Fails closed:
 * a malformed ref, no match, another team's membership, or two matches all
 * yield `null`.
 */
export function resolveMemberRef(
  memberships: readonly unknown[],
  teamId: string,
  ref: unknown,
): Record<string, unknown> | null {
  if (!isMemberRef(ref)) {
    return null;
  }
  const matches = memberships.filter(
    (data): data is Record<string, unknown> =>
      typeof data === "object" &&
      data !== null &&
      (data as Record<string, unknown>).teamId === teamId &&
      memberRefOf(data) === ref,
  );
  return matches.length === 1 ? matches[0] : null;
}

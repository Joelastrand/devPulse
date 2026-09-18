import { createHash } from "node:crypto";

/**
 * Deterministic, pseudonymous, per-team author display tag (docs/features/
 * team-forum/SPEC.md — "Identity/attribution model" → "Author tag
 * derivation", BR-11, BR-49, BR-50). A pure function of `(teamId,
 * authorUid)` alone — no Firestore read, no Firebase Auth call, no
 * `server-only` import, no async, no I/O of any kind, and no persisted
 * field anywhere. Never derived from, and never convertible back to, an
 * email address, display name, or the raw `authorUid` itself.
 *
 * Formula (SPEC — exact, do not substitute): `uppercase(hex(SHA-256(
 * \`${teamId}:${authorUid}\`)).slice(0, 6))`. The same `(teamId, authorUid)`
 * pair always yields the same tag; a different `teamId` for the same
 * `authorUid` yields a different tag (SPEC — "Same author, different teams
 * → different tags"), which also means this tag is unaffected by the
 * author's Firebase account being deleted or their team membership being
 * later removed (BR-12) — it never depends on either existing.
 */
export function authorTag(teamId: string, authorUid: string): string {
  const digest = createHash("sha256").update(`${teamId}:${authorUid}`).digest("hex");

  return digest.slice(0, 6).toUpperCase();
}

/**
 * A challenge's derived lifecycle state — never a separately stored status
 * field that could drift from its derivation (docs/features/
 * anonymous-challenges/SPEC.md — "Lifecycle", BR-6). Always recomputed from
 * `resolvedAt`/`archivedAt` via `effectiveChallengeStatus`.
 */
export type ChallengeStatus = "open" | "resolved" | "archived";

/**
 * The exact key-version literal `src/lib/encryption/encryption.ts` ever
 * produces. Declared independently here (not imported from that module)
 * so this domain module stays framework/I-O free — this module never
 * imports `server-only`, Firebase, or any encryption implementation, only
 * the shape its persisted output must satisfy.
 */
export type ChallengeKeyVersion = "v1";

const CHALLENGE_KEY_VERSION: ChallengeKeyVersion = "v1";

/**
 * The canonical, persisted `Challenge` domain shape (docs/features/
 * anonymous-challenges/SPEC.md — "Data model"). `challengeId` is a stable,
 * opaque, Firestore auto-generated document ID — never derived from
 * `teamId`, `uid`, or the challenge's own text, and never client-supplied.
 *
 * Deliberately carries no submitter identity field of any kind (no `uid`,
 * `email`, `displayName`, `membershipId`, or `submittedBy`) — this is the
 * privacy guarantee the whole feature is built around (SPEC —
 * "Privacy/anonymity model"). `resolvedBy`/`archivedBy` are the *acting
 * admin's* uid, persisted for internal accountability only; they identify
 * who managed the challenge, never who submitted it.
 *
 * This is the one place this shape is declared; later tasks (persistence,
 * server operations, UI) import it rather than inlining their own
 * object-shape annotations for "a challenge document."
 */
export interface Challenge {
  challengeId: string;
  teamId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: ChallengeKeyVersion;
  submittedAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  archivedAt?: Date;
  archivedBy?: string;
}

/**
 * The narrow slice of `Challenge` that `effectiveChallengeStatus` depends
 * on — a function should only depend on the fields it actually uses
 * (`.claude/rules/typescript.md`), and this derivation needs no decryption
 * and no identity of any kind.
 */
export interface ChallengeLifecycleFields {
  resolvedAt?: Date;
  archivedAt?: Date;
}

/**
 * The single authoritative derivation of a challenge's lifecycle state,
 * computed identically everywhere it's used (docs/features/
 * anonymous-challenges/SPEC.md — "Lifecycle"):
 *
 * - `archived` if `archivedAt` is set — takes precedence even when
 *   `resolvedAt` is also set (a challenge archived directly from `open`
 *   never had `resolvedAt` set at all; a challenge archived after being
 *   resolved keeps its `resolvedAt`, but the derived status is still
 *   `archived`).
 * - `resolved` else if `resolvedAt` is set.
 * - `open` otherwise.
 *
 * Unlike a survey's `effectiveLifecycle`, this derivation depends on no
 * clock/`now` — it is purely a function of which optional timestamps are
 * present, never of elapsed time.
 */
export function effectiveChallengeStatus(
  challenge: ChallengeLifecycleFields,
): ChallengeStatus {
  if (challenge.archivedAt !== undefined) {
    return "archived";
  }

  if (challenge.resolvedAt !== undefined) {
    return "resolved";
  }

  return "open";
}

/**
 * Fail-closed runtime validator for a candidate `Challenge` object — the
 * guard every later Firestore-reading task must go through before treating
 * raw document data as a `Challenge`, instead of an unchecked cast from
 * `DocumentData` (`.claude/rules/typescript.md`). Callers are expected to
 * have already mapped a raw Firestore document into this candidate shape
 * (document ID → `challengeId`, `Timestamp` fields → `Date`, exactly as
 * this codebase's existing Firestore-read call sites already do) — this
 * module has no Firestore/I/O dependency of its own.
 *
 * Returns `false` (never throws) for a missing/non-object candidate, a
 * `challengeId` that doesn't match `expected.challengeId`, a missing/blank
 * `teamId`, a missing/blank `ciphertext`/`iv`/`authTag`, a `keyVersion`
 * that isn't the exact literal `"v1"` (a syntactically-valid-but-wrong
 * value like `"v2"` or `""` is rejected, not just "any string" — this
 * codebase's encryption module only ever produces `"v1"`), a missing or
 * invalid `submittedAt`, or a `resolvedAt`/`resolvedBy` pair (or
 * `archivedAt`/`archivedBy` pair) that isn't either both present and
 * well-typed or both absent.
 *
 * Deliberately does not accept, and is not weakened by, any extra
 * identity-shaped field (e.g. `uid`) a malformed/tampered candidate might
 * carry — this validator only ever checks the fields above; an extra field
 * on the input has no bearing on the result.
 */
export function isValidChallenge(
  data: unknown,
  expected: { challengeId: string },
): data is Challenge {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }

  const record = data as Record<string, unknown>;

  return (
    record.challengeId === expected.challengeId &&
    isNonEmptyString(record.teamId) &&
    isNonEmptyString(record.ciphertext) &&
    isNonEmptyString(record.iv) &&
    isNonEmptyString(record.authTag) &&
    record.keyVersion === CHALLENGE_KEY_VERSION &&
    isValidDate(record.submittedAt) &&
    isValidLifecycleActorPair(record.resolvedAt, record.resolvedBy) &&
    isValidLifecycleActorPair(record.archivedAt, record.archivedBy)
  );
}

/**
 * A management-transition timestamp (`resolvedAt`/`archivedAt`) and its
 * acting-admin uid (`resolvedBy`/`archivedBy`) must appear together or not
 * at all — one present without the other is a malformed record, never
 * partially trusted.
 */
function isValidLifecycleActorPair(timestamp: unknown, actor: unknown): boolean {
  if (timestamp === undefined && actor === undefined) {
    return true;
  }

  return isValidDate(timestamp) && isNonEmptyString(actor);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

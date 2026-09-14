import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { effectiveChallengeStatus, isValidChallenge, type Challenge } from "../domain/challenge";

const CHALLENGES_COLLECTION = "challenges";

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface ArchiveChallengeDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The read/write seam for the target `challenges/{challengeId}` document
 * itself, satisfied in production by direct Firestore document calls and by
 * an in-memory fake in tests. Kept as its own local seam per this
 * codebase's established one-seam-per-operation convention (mirrors
 * `resolve-challenge.ts`'s `ChallengeDocStore`, kept as a separate local
 * interface here rather than a shared import — each management operation
 * owns its own narrow seam, exactly as `close-survey.ts`/
 * `delete-or-archive-survey.ts` each declare their own).
 */
export interface ChallengeDocStore {
  get(challengeId: string): Promise<ArchiveChallengeDocSnapshot>;
  update(challengeId: string, data: Record<string, unknown>): Promise<void>;
}

function getDefaultChallengeDocStore(): ChallengeDocStore {
  return {
    async get(challengeId) {
      const snapshot = await getFirestoreDb()
        .collection(CHALLENGES_COLLECTION)
        .doc(challengeId)
        .get();
      return { exists: snapshot.exists, data: () => snapshot.data() };
    },
    async update(challengeId, data) {
      await getFirestoreDb().collection(CHALLENGES_COLLECTION).doc(challengeId).update(data);
    },
  };
}

/** Maps raw Firestore document data (Timestamp fields included) into the candidate shape `isValidChallenge` expects. */
function toCandidateChallenge(challengeId: string, data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  return {
    ...record,
    challengeId,
    submittedAt: toDateOrUndefined(record.submittedAt),
    resolvedAt: toDateOrUndefined(record.resolvedAt),
    archivedAt: toDateOrUndefined(record.archivedAt),
  };
}

function toDateOrUndefined(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  // Left as-is (not a Date) so `isValidChallenge`'s `isValidDate` check
  // fails closed on it, rather than silently coercing an unexpected shape.
  return value;
}

export type ArchiveChallengeResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "not_found" | "wrong_team" | "persistence_failed";
    };

export interface ArchiveChallengeDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  docs?: ChallengeDocStore;
}

/**
 * Archives an `open` or `resolved` challenge (docs/features/
 * anonymous-challenges/SPEC.md — BR-16, BR-18, BR-21, BR-22). Only an app
 * admin may call this successfully — reuses `requireAppAdmin` unchanged; a
 * plain team member, even of their own team, is rejected `forbidden`.
 *
 * `teamId` is always the caller's own trusted server/route scope, never
 * inferred from the challenge until *after* it has been fetched and
 * fail-closed validated (`isValidChallenge`) — a `challengeId` that
 * resolves to a different team's challenge is rejected (`wrong_team`),
 * never silently mutated under the wrong scope (BR-21). A
 * missing/malformed challenge document is rejected `not_found` without any
 * write.
 *
 * No `teams/{teamId}.status` read at all — archiving works regardless of
 * the owning team's `active`/`disabled` status (BR-22).
 *
 * Idempotent on an already-`archived` challenge: no error, and
 * `archivedAt`/`archivedBy` are left exactly as they were, never rewritten
 * (BR-18). Any already-present `resolvedAt`/`resolvedBy` is preserved
 * unchanged by every branch — this operation only ever writes
 * `archivedAt`/`archivedBy`, never touching the resolve pair (SPEC —
 * "Lifecycle" → "Persisted fields per transition"). No "unarchive" path
 * exists anywhere in this feature (BR-19).
 *
 * No Firestore transaction is used — a single-document read-then-write
 * with no cross-document invariant to protect (SPEC — "Server
 * operations"). Two concurrent `archiveChallenge` calls on the same
 * challenge can both read a pre-archived status before either writes, so
 * `archivedAt`/`archivedBy` may end up reflecting whichever call's plain
 * `update()` physically lands last — an accepted residual risk (SPEC —
 * "Accepted residual risks" #7), since those fields are never returned by
 * any API response (BR-13) and the derived *status* is correct either way.
 */
export async function archiveChallenge(
  idToken: string,
  teamId: string,
  challengeId: string,
  deps: ArchiveChallengeDeps = {},
): Promise<ArchiveChallengeResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const docs = deps.docs ?? getDefaultChallengeDocStore();

  let snapshot: ArchiveChallengeDocSnapshot;
  try {
    snapshot = await docs.get(challengeId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const candidate = toCandidateChallenge(challengeId, snapshot.exists ? snapshot.data() : undefined);
  if (!isValidChallenge(candidate, { challengeId })) {
    return { ok: false, error: "not_found" };
  }
  const challenge: Challenge = candidate;

  if (challenge.teamId !== teamId) {
    return { ok: false, error: "wrong_team" };
  }

  if (effectiveChallengeStatus(challenge) === "archived") {
    return { ok: true };
  }

  const now = deps.now ?? new Date();
  try {
    await docs.update(challengeId, { archivedAt: now, archivedBy: admin.identity.uid });
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

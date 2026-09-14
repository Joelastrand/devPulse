import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { isValidChallenge, type Challenge } from "../domain/challenge";

const CHALLENGES_COLLECTION = "challenges";

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface DeleteChallengeDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The read/write seam for the target `challenges/{challengeId}` document
 * itself, satisfied in production by direct Firestore document calls and by
 * an in-memory fake in tests. Kept as its own local seam per this
 * codebase's established one-seam-per-operation convention (mirrors
 * `resolve-challenge.ts`/`archive-challenge.ts`'s own `ChallengeDocStore`
 * seams — this operation only ever needs `get`/`delete`, never `update`).
 */
export interface ChallengeDocStore {
  get(challengeId: string): Promise<DeleteChallengeDocSnapshot>;
  delete(challengeId: string): Promise<void>;
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
    async delete(challengeId) {
      await getFirestoreDb().collection(CHALLENGES_COLLECTION).doc(challengeId).delete();
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

export type DeleteChallengeResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "not_found" | "wrong_team" | "persistence_failed";
    };

export interface DeleteChallengeDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  docs?: ChallengeDocStore;
}

/**
 * Permanently deletes a challenge, regardless of its current derived
 * status (docs/features/anonymous-challenges/SPEC.md — BR-16, BR-20,
 * BR-21, BR-22). Only an app admin may call this successfully — reuses
 * `requireAppAdmin` unchanged; a plain team member, even of their own
 * team, is rejected `forbidden`.
 *
 * `teamId` is always the caller's own trusted server/route scope, never
 * inferred from the challenge until *after* it has been fetched and
 * fail-closed validated (`isValidChallenge`) — a `challengeId` that
 * resolves to a different team's challenge is rejected (`wrong_team`),
 * never silently deleted under the wrong scope (BR-21). A
 * missing/malformed challenge document is rejected `not_found` without any
 * write — a malformed document can't be deleted through this normal
 * operation either (SPEC — "Edge cases and failure behavior").
 *
 * No `teams/{teamId}.status` read at all — deletion works regardless of
 * the owning team's `active`/`disabled` status (BR-22).
 *
 * Unlike survey delete, there is no response-count-style precondition
 * (BR-20) — a challenge document is itself the only content that could
 * ever be lost, and there is no companion record it could orphan, so any
 * status (`open`, `resolved`, or `archived`) is deleted the same way, with
 * no separate "already deleted" outcome: a second call against the same
 * `challengeId` simply finds no document and returns `not_found`, exactly
 * like a call against a `challengeId` that never existed. No structured
 * deletion audit trail is written (SPEC Non-goals) — this operation leaves
 * no persisted trace beyond ordinary, content-free server request logs.
 */
export async function deleteChallenge(
  idToken: string,
  teamId: string,
  challengeId: string,
  deps: DeleteChallengeDeps = {},
): Promise<DeleteChallengeResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const docs = deps.docs ?? getDefaultChallengeDocStore();

  let snapshot: DeleteChallengeDocSnapshot;
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

  try {
    await docs.delete(challengeId);
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

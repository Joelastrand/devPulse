import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../../teams/domain/app-admin";
import { isValidForumThread, type ForumThreadRecord } from "../domain/forum-thread";

const FORUM_THREADS_COLLECTION = "forumThreads";
const FORUM_REPLIES_COLLECTION = "forumReplies";

/**
 * The maximum number of reply documents `deleteThread`'s cascade deletes in
 * one Firestore `WriteBatch` per loop iteration (docs/features/team-forum/
 * SPEC.md — BR-54). Firestore's own per-batch write-count limit is 500, so
 * this size keeps every batch safely within it by construction.
 */
export const DELETE_THREAD_CASCADE_BATCH_SIZE = 500;

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface DeleteThreadDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The read/write seam for the target `forumThreads/{threadId}` document
 * itself, satisfied in production by direct Firestore document calls and by
 * an in-memory fake in tests. Mirrors `delete-challenge.ts`'s
 * `ChallengeDocStore` seam shape (get/delete only, no update).
 */
export interface ForumThreadDocStore {
  get(threadId: string): Promise<DeleteThreadDocSnapshot>;
  delete(threadId: string): Promise<void>;
}

function getDefaultForumThreadDocStore(): ForumThreadDocStore {
  return {
    async get(threadId) {
      const snapshot = await getFirestoreDb().collection(FORUM_THREADS_COLLECTION).doc(threadId).get();
      return { exists: snapshot.exists, data: () => snapshot.data() };
    },
    async delete(threadId) {
      await getFirestoreDb().collection(FORUM_THREADS_COLLECTION).doc(threadId).delete();
    },
  };
}

/**
 * The cascade-delete seam for a thread's replies (docs/features/team-forum/
 * SPEC.md — BR-54). `deleteNextBatch` queries up to
 * `DELETE_THREAD_CASCADE_BATCH_SIZE` reply documents for `threadId` (no
 * ordering needed) and deletes every one of them in a single Firestore
 * `WriteBatch`, returning how many it deleted — `0` signals the cascade is
 * complete. `deleteThread` calls this repeatedly until it returns `0`,
 * rather than assuming one bounded pass is always sufficient, so it stays
 * correct even if BR-53's rare over-cap race ever pushed a thread's real
 * reply count above its nominal 500 cap.
 */
export interface RepliesCascadeStore {
  deleteNextBatch(threadId: string): Promise<number>;
}

function getDefaultRepliesCascadeStore(): RepliesCascadeStore {
  return {
    async deleteNextBatch(threadId) {
      const db = getFirestoreDb();
      const snapshot = await db
        .collection(FORUM_REPLIES_COLLECTION)
        .where("threadId", "==", threadId)
        .limit(DELETE_THREAD_CASCADE_BATCH_SIZE)
        .get();

      if (snapshot.empty) {
        return 0;
      }

      const batch = db.batch();
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      return snapshot.size;
    },
  };
}

/** Maps raw Firestore document data (a Timestamp `createdAt` included) into the candidate shape `isValidForumThread` expects. */
function toCandidateThread(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  return { ...record, createdAt: toDateOrUndefined(record.createdAt) };
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
  return value;
}

export type DeleteThreadResult =
  | { ok: true }
  | { ok: false; error: "sign_in_required" | "forbidden" | "not_found" | "persistence_failed" };

export interface DeleteThreadDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  threadDocs?: ForumThreadDocStore;
  repliesCascade?: RepliesCascadeStore;
}

/**
 * Permanently deletes a thread and every one of its replies (docs/features/
 * team-forum/SPEC.md — "Server operations" → `deleteThread`; BR-23 through
 * BR-25, BR-27, BR-31, BR-32, BR-54, BR-55). This is a genuine hard delete,
 * not a soft-delete/tombstone — per Owner Decision 2, a deleted thread's
 * content must not remain anywhere, decryptable or not.
 *
 * Order of checks, in this exact sequence:
 * verify the ID token (`sign_in_required`) → fetch `forumThreads/{threadId}`
 * and validate it (`isValidForumThread`, TASK-001); missing, malformed, or a
 * `teamId` mismatch against the route scope all resolve to the identical
 * `not_found` (BR-32 — a non-owner, non-admin caller must not learn a thread
 * exists in another team merely by probing a delete call, and a
 * previously-deleted `threadId` is indistinguishable from one that never
 * existed) → authorize: `isAppAdmin(identity)` **or** `thread.authorUid ===
 * identity.uid`, else `forbidden` (BR-23) — deliberately does **not**
 * re-verify the author's *current* real team membership (an ex-member may
 * still delete their own past thread; see SPEC "Lifecycle/moderation").
 *
 * **Step 1**: delete the thread document itself first (BR-55 — this
 * ordering, not the reverse, minimizes the narrow orphan-reply race window
 * documented in SPEC's "Edge cases and concurrency"; it does not eliminate
 * it).
 *
 * **Step 2**: repeatedly query and batch-delete the thread's replies
 * (`RepliesCascadeStore.deleteNextBatch`, BR-54) until none remain — correct
 * regardless of whether BR-53's rare over-cap race ever pushed the thread's
 * real reply count above its nominal 500 cap.
 *
 * Not a Firestore transaction (SPEC — "Not a Firestore transaction"): a
 * transaction spanning the thread delete plus up to 500+ reply deletes would
 * itself risk Firestore's per-transaction operation-count limits. Neither
 * step reads `teams/{teamId}.status` — deletion is never gated on the
 * owning team's `active`/`disabled` status (BR-31).
 *
 * Fails closed on any Firestore error during either step →
 * `persistence_failed`.
 */
export async function deleteThread(
  idToken: string,
  teamId: string,
  threadId: string,
  deps: DeleteThreadDeps = {},
): Promise<DeleteThreadResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "sign_in_required" };
  }

  const threadDocs = deps.threadDocs ?? getDefaultForumThreadDocStore();

  let snapshot: DeleteThreadDocSnapshot;
  try {
    snapshot = await threadDocs.get(threadId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const candidate = toCandidateThread(snapshot.exists ? snapshot.data() : undefined);
  if (!isValidForumThread(candidate) || candidate.teamId !== teamId) {
    // Missing, malformed, and cross-team all resolve to the identical
    // not_found (BR-32) — a hard-deleted thread's document is
    // indistinguishable from one that never existed.
    return { ok: false, error: "not_found" };
  }
  const thread: ForumThreadRecord = candidate;

  const admin = isAppAdmin(verified.identity, { allowList: deps.allowList });
  if (!admin && thread.authorUid !== verified.identity.uid) {
    return { ok: false, error: "forbidden" };
  }

  try {
    await threadDocs.delete(threadId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const repliesCascade = deps.repliesCascade ?? getDefaultRepliesCascadeStore();
  try {
    let deletedInBatch = await repliesCascade.deleteNextBatch(threadId);
    while (deletedInBatch > 0) {
      deletedInBatch = await repliesCascade.deleteNextBatch(threadId);
    }
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  return { ok: true };
}

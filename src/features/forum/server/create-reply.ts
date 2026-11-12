import "server-only";
import { encryptRecord } from "../../../lib/encryption/record-envelope";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { runFencedTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import { isValidForumThread, type ForumThreadRecord } from "../domain/forum-thread";
import { forumReplyContext, type ActiveForumReply } from "../domain/forum-reply";
import { validateReplyBody } from "../domain/reply-content";
import { type AuthRefusal, authRefusalFor } from "../../auth/server/auth-refusal";

const FORUM_THREADS_COLLECTION = "forumThreads";
const FORUM_REPLIES_COLLECTION = "forumReplies";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** The reply-count threshold `createReply` enforces at creation time (docs/archive/features/team-forum/SPEC.md — BR-52). */
export const REPLY_CAPACITY_LIMIT = 500;

/**
 * The write seam this operation depends on. Inside the transaction it is the transaction's own `create`, so the reply is
 * written only if the transaction commits (TASK-029). No id is returned: SPEC "Reply capacity" explains why `createReply`
 * needs none.
 */
export interface ForumRepliesCollection {
  /** Reserves the reply's document id before encryption (the body is sealed with AAD `forum-reply:<teamId>:<threadId>:<replyId>`). */
  reserveId(): string;
  create(replyId: string, record: ActiveForumReply): void;
}

/** The read seam for a real `teamMemberships/{uid}__{teamId}` record — same shape as `createThread`'s (BR-1). */
export interface MembershipReader {
  getMembership(uid: string, teamId: string): Promise<unknown>;
}

/** The read seam for the owning team's fresh `status` — same shape as `createThread`'s (BR-7). */
export interface TeamStatusReader {
  getTeamStatus(teamId: string): Promise<unknown>;
}

/**
 * The read seam for the target thread's own document. Returns raw, unvalidated data (`undefined` if no such document
 * exists) — `createReply` validates it before trusting it.
 */
export interface ThreadReader {
  getThread(threadId: string): Promise<unknown>;
}

/**
 * The read seam for the target thread's current reply count. Production reads it with a count aggregation inside the
 * transaction (`where("threadId", "==", threadId)`, no composite index, SPEC "Firestore/index implications").
 */
export interface ReplyCountReader {
  countRepliesForThread(threadId: string): Promise<number>;
}

/**
 * Everything one reply creation reads and writes, bound to one Firestore transaction (TASK-029). Every read happens through
 * the same transaction as the write, so a membership, team, thread or count that changes before commit makes the commit
 * retry or fail rather than be used stale.
 */
export interface ReplyTransactionScope {
  membershipReader: MembershipReader;
  teamStatusReader: TeamStatusReader;
  threadReader: ThreadReader;
  replyCountReader: ReplyCountReader;
  collection: ForumRepliesCollection;
}

/**
 * Runs `work` in one transaction whose first operation is the erasure fence read for `uid` (BR-4(b), TASK-004). An existing
 * record refuses before `work` runs, so no read or write happens. Firestore may re-run `work`, so it must be retry-safe.
 */
export type ReplyTransactionRunner = <T>(uid: string, work: (scope: ReplyTransactionScope) => Promise<T>) => Promise<T>;

/** Production runner: one Admin SDK transaction. Every read and the single create go through the transaction object. */
function runReplyTransaction<T>(uid: string, work: (scope: ReplyTransactionScope) => Promise<T>): Promise<T> {
  const db = getFirestoreDb();
  return runFencedTransaction(db, uid, (tx) =>
    work({
      membershipReader: {
        async getMembership(memberUid, teamId) {
          const snapshot = await tx.get(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(memberUid, teamId)));
          return snapshot.exists ? snapshot.data() : undefined;
        },
      },
      teamStatusReader: {
        async getTeamStatus(teamId) {
          const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
          return snapshot.exists ? snapshot.data()?.status : undefined;
        },
      },
      threadReader: {
        async getThread(threadId) {
          const snapshot = await tx.get(db.collection(FORUM_THREADS_COLLECTION).doc(threadId));
          return snapshot.exists ? snapshot.data() : undefined;
        },
      },
      replyCountReader: {
        async countRepliesForThread(threadId) {
          const snapshot = await tx.get(
            db.collection(FORUM_REPLIES_COLLECTION).where("threadId", "==", threadId).count(),
          );
          return snapshot.data().count;
        },
      },
      collection: {
        reserveId() {
          return db.collection(FORUM_REPLIES_COLLECTION).doc().id;
        },
        create(replyId, record) {
          tx.create(db.collection(FORUM_REPLIES_COLLECTION).doc(replyId), record);
        },
      },
    }),
  );
}

/** Maps raw Firestore thread document data (a Timestamp `createdAt` included) into the candidate shape `isValidForumThread` expects. */
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

export type CreateReplyResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "sign_in_required"
        | AuthRefusal
        | "invalid_input"
        | "forbidden"
        | "team_disabled"
        | "not_found"
        | "thread_full"
        | "encryption_failed"
        | "erasure_in_progress"
        | "persistence_failed";
    };

export interface CreateReplyDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  /** Tests inject a transaction runner over fakes. Production uses the Admin SDK transaction. */
  runReplyTransaction?: ReplyTransactionRunner;
}

/**
 * Creates one reply to `threadId` within `teamId` (docs/archive/features/team-forum/SPEC.md — "Server operations" → `createReply`;
 * BR-1, BR-2, BR-4, BR-5, BR-6, BR-7, BR-8, BR-9, BR-35, BR-47, BR-52, BR-53). `teamId`/`threadId` are the caller's trusted
 * route scope; `authorUid` is always the verified caller's own `uid`.
 *
 * Order: verify the ID token (`sign_in_required`) → validate `rawBody` (`invalid_input`, nothing read yet) → one transaction,
 * whose first operation is the erasure fence read for the caller (TASK-029, BR-4(b)). Inside it, in this order: a real
 * `teamMemberships/{uid}__{teamId}` record (`forbidden`, BR-1) → a fresh `teams/{teamId}.status` of `active`
 * (`team_disabled`, BR-7) → `forumThreads/{threadId}` validated, with the same `teamId` (`not_found`, BR-8; a placeholder of an
 * erased thread fails validation and so resolves to `not_found`, TASK-015) → the reply count, `>= 500` → `thread_full`
 * (BR-52) → encrypt the body (fresh IV) → one `forumReplies` create with `teamId` taken from the validated thread (BR-35).
 *
 * Every read is in the same transaction as the create, so a membership, team, thread or count that changes before commit
 * makes Firestore retry the transaction instead of using a stale value (no TOCTOU). The cap check remains best-effort
 * (BR-53). A fence refusal returns `erasure_in_progress` through the shared mapping, with no read after it and no write.
 * Callback work is pure apart from the transaction's own reads and the single create, so a retry repeats no external effect.
 *
 * Returns `{ok: true}` only — no `replyId` (SPEC "Reply capacity"). Fails closed: a read, transaction or write error maps to
 * `persistence_failed`; an `encrypt` failure to `encryption_failed`. Neither falls back to plaintext, and neither logs detail
 * from the thrown error (BR-36).
 */
export async function createReply(
  idToken: string,
  teamId: string,
  threadId: string,
  rawBody: unknown,
  deps: CreateReplyDeps = {},
): Promise<CreateReplyResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: verified.error === "invalid_token" ? "sign_in_required" : authRefusalFor(verified) };
  }

  const validatedBody = validateReplyBody(rawBody);
  if (!validatedBody.ok) {
    return { ok: false, error: "invalid_input" };
  }

  const runTransaction = deps.runReplyTransaction ?? runReplyTransaction;
  const now = deps.now ?? new Date();
  try {
    return await runTransaction(verified.identity.uid, (scope) =>
      createReplyInTransaction(scope, verified.identity.uid, teamId, threadId, validatedBody.body, now),
    );
  } catch (error) {
    // A fence refusal is `erasure_in_progress`; any other transaction or read failure is `persistence_failed`. The raw error
    // is never returned.
    return { ok: false, error: writeRefusalFor(error) };
  }
}

/** The reads, checks and the single create of one reply, run inside the transaction. Pure apart from its reads and create. */
async function createReplyInTransaction(
  scope: ReplyTransactionScope,
  authorUid: string,
  teamId: string,
  threadId: string,
  body: string,
  now: Date,
): Promise<CreateReplyResult> {
  // Read errors are not caught here: a thrown error lets Firestore retry the transaction on contention, and the caller maps
  // any non-refusal failure to persistence_failed (createReply).
  const rawMembership = await scope.membershipReader.getMembership(authorUid, teamId);
  if (!isValidMembershipFor(rawMembership, { uid: authorUid, teamId })) {
    return { ok: false, error: "forbidden" };
  }

  const rawTeamStatus = await scope.teamStatusReader.getTeamStatus(teamId);
  if (!isValidTeamStatus(rawTeamStatus) || rawTeamStatus !== "active") {
    // Covers "disabled", "nonexistent" (`undefined`), and any other malformed status uniformly (BR-7).
    return { ok: false, error: "team_disabled" };
  }

  const rawThread = await scope.threadReader.getThread(threadId);
  const candidateThread = toCandidateThread(rawThread);
  if (!isValidForumThread(candidateThread) || candidateThread.teamId !== teamId) {
    // Missing, malformed, cross-team, and an erased-thread placeholder all resolve to the identical not_found (BR-8, TASK-015).
    return { ok: false, error: "not_found" };
  }
  const thread: ForumThreadRecord = candidateThread;

  const currentReplyCount = await scope.replyCountReader.countRepliesForThread(threadId);

  if (currentReplyCount >= REPLY_CAPACITY_LIMIT) {
    return { ok: false, error: "thread_full" };
  }

  const replyId = scope.collection.reserveId();
  let encrypted;
  try {
    encrypted = encryptRecord(body, forumReplyContext(thread.teamId, threadId, replyId));
  } catch {
    return { ok: false, error: "encryption_failed" };
  }

  const record: ActiveForumReply = {
    teamId: thread.teamId,
    threadId,
    authorUid,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    keyId: encrypted.keyId,
    createdAt: now,
  };

  scope.collection.create(replyId, record);
  return { ok: true };
}

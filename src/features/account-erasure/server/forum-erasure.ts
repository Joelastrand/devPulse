import { isValidForumReply, isForumReplyDeleted } from "../../forum/domain/forum-reply";
import { isValidForumThread } from "../../forum/domain/forum-thread";
import { ERASED_THREAD_STATUS, isErasedForumThread } from "../../forum/domain/forum-erased-thread";
import { ERASED_ACTOR_MARKER } from "../domain/erasure-constants";
import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";

/**
 * The `forum` erasure step (TASK-014; SPEC BR-7, D3, I-13, I-14, A-8). Pure logic over an injected port, so it never
 * decrypts and never reads content it does not need.
 *
 * Each batch does one unit of work and reports `"done"` only when all three verification queries return nothing:
 *   1. a thread authored by the erased person: placeholder when another person has an active reply, otherwise the
 *      thread and every reply in it are deleted in bounded chunks;
 *   2. an active reply authored by the erased person: converted to the tombstone shape (I-14);
 *   3. a tombstone whose `deletedBy` is the erased person: marker set to `"erased"` (A-8).
 *
 * Firestore allows at most 500 writes per transaction and replies are capped at 500, so a thread delete is not one
 * transaction. Its replies are removed in chunks of `maxWrites` first, then the thread is removed in a transaction that
 * re-checks the invariant. A retry after an interruption re-runs the decision from current data, so it is safe.
 */

export interface ForumRaw {
  readonly id: string;
  readonly data: unknown;
}

export interface ForumTransaction {
  getThread(threadId: string): Promise<unknown>;
  getThreadReplies(threadId: string): Promise<ForumRaw[]>;
  setThread(threadId: string, data: Record<string, unknown>): void;
  deleteThread(threadId: string): void;
  getReply(replyId: string): Promise<unknown>;
  setReply(replyId: string, data: Record<string, unknown>): void;
  deleteReply(replyId: string): void;
}

export interface ForumErasurePort {
  runTransaction<T>(work: (tx: ForumTransaction) => Promise<T>): Promise<T>;
  /** Thread ids whose `authorUid` is the uid, at most `limit`. */
  threadIdsAuthoredBy(uid: string, limit: number): Promise<string[]>;
  /** Reply ids whose `authorUid` is the uid (active replies only), at most `limit`. */
  replyIdsAuthoredBy(uid: string, limit: number): Promise<string[]>;
  /** Tombstone reply ids whose `deletedBy` is the uid, at most `limit` (A-8). */
  replyIdsDeletedBy(uid: string, limit: number): Promise<string[]>;
}

export interface ForumStepDeps {
  readonly port: ForumErasurePort;
  readonly now: () => Date;
}

export function createForumStepHandler(deps: ForumStepDeps): StepHandler {
  return {
    runBatch: ({ uid, maxWrites }) => runForumBatch(deps, uid, maxWrites),
  };
}

export async function runForumBatch(deps: ForumStepDeps, uid: string, maxWrites: number): Promise<BatchResult> {
  const { port } = deps;
  // A zero budget could report "done" while replies still match, so it is a programming error, not a batch result.
  if (!Number.isInteger(maxWrites) || maxWrites < 1) throw new RangeError("maxWrites must be a positive integer");

  const threadIds = await port.threadIdsAuthoredBy(uid, 1);
  const threadId = threadIds[0];
  if (threadId !== undefined) {
    await decideThread(deps, uid, threadId, maxWrites);
    return "more";
  }

  // One batch is one write budget (`maxWrites`, SPEC BR-14), shared by both reply loops, so a batch never writes twice that.
  const replyIds = await port.replyIdsAuthoredBy(uid, maxWrites);
  for (const replyId of replyIds) {
    await tombstoneOwnReply(deps, uid, replyId);
  }

  const remaining = maxWrites - replyIds.length;
  const markedIds = remaining > 0 ? await port.replyIdsDeletedBy(uid, remaining) : [];
  for (const replyId of markedIds) {
    await markOtherTombstone(deps, uid, replyId);
  }

  return replyIds.length === 0 && markedIds.length === 0 ? "done" : "more";
}

/** One transaction per call. It reads the thread and its replies, then writes at most `maxWrites` operations. */
async function decideThread(deps: ForumStepDeps, uid: string, threadId: string, maxWrites: number): Promise<void> {
  await deps.port.runTransaction(async (tx) => {
    const thread = await tx.getThread(threadId);
    // Missing, or already the erased placeholder: a stale query or a racing run has reached the desired state. Not a
    // payload fault (the author link is already gone), so nothing is written and nothing is reported as unreadable.
    if (thread === undefined || isErasedForumThread(thread)) return;
    // A thread the query returned but that cannot be read safely must stop the step. Skipping it would leave the
    // author link in place and loop until the budget ran out.
    if (!isValidForumThread(thread)) throw new ErasureStepFailure("payload_unreadable");
    if (thread.authorUid !== uid) return;

    const replies = await tx.getThreadReplies(threadId);

    const classified = replies.map((reply) => ({ id: reply.id, kind: classifyReply(reply.data, uid) }));
    if (classified.some((entry) => entry.kind === "malformed")) {
      throw new ErasureStepFailure("payload_unreadable");
    }
    const othersActive = classified.some((entry) => entry.kind === "other");

    if (othersActive) {
      tx.setThread(threadId, {
        teamId: thread.teamId,
        createdAt: thread.createdAt,
        erasedAt: deps.now(),
        status: ERASED_THREAD_STATUS,
      });
      return;
    }

    if (classified.length > 0) {
      for (const entry of classified.slice(0, maxWrites)) tx.deleteReply(entry.id);
      return;
    }

    tx.deleteThread(threadId);
  });
}

/** I-14: an active reply by the erased person becomes the tombstone shape. */
async function tombstoneOwnReply(deps: ForumStepDeps, uid: string, replyId: string): Promise<void> {
  await deps.port.runTransaction(async (tx) => {
    const reply = await tx.getReply(replyId);
    // Missing, or already a tombstone (no author field to convert): the desired state is reached, so this is a no-op.
    if (reply === undefined) return;
    if (!isValidForumReply(reply)) throw new ErasureStepFailure("payload_unreadable");
    if (isForumReplyDeleted(reply) || reply.authorUid !== uid) return;

    tx.setReply(replyId, {
      teamId: reply.teamId,
      threadId: reply.threadId,
      createdAt: reply.createdAt,
      deletedAt: deps.now(),
      deletedBy: ERASED_ACTOR_MARKER,
    });
  });
}

/** A-8: another person's tombstone with `deletedBy` = the erased uid gets the marker. Nothing else changes. */
async function markOtherTombstone(deps: ForumStepDeps, uid: string, replyId: string): Promise<void> {
  await deps.port.runTransaction(async (tx) => {
    const reply = await tx.getReply(replyId);
    // Missing, or no longer a tombstone held by the erased uid (a racing run marked it): nothing left to change.
    if (reply === undefined) return;
    if (!isValidForumReply(reply)) throw new ErasureStepFailure("payload_unreadable");
    if (!isForumReplyDeleted(reply) || reply.deletedBy !== uid) return;

    tx.setReply(replyId, {
      teamId: reply.teamId,
      threadId: reply.threadId,
      createdAt: reply.createdAt,
      deletedAt: reply.deletedAt,
      deletedBy: ERASED_ACTOR_MARKER,
    });
  });
}

type ReplyKind = "tombstone" | "own" | "other" | "malformed";

/**
 * Classifies one reply for the decision. A reply that cannot be read safely is `malformed`, and any malformed reply in a
 * thread stops the decision (SPEC: a payload that cannot be read must not be reported as complete).
 */
function classifyReply(data: unknown, uid: string): ReplyKind {
  if (!isValidForumReply(data)) return "malformed";
  if (isForumReplyDeleted(data)) return "tombstone";
  return data.authorUid === uid ? "own" : "other";
}


import "server-only";
import { encrypt } from "../../../lib/encryption/encryption";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import { isValidForumThread, type ForumThreadRecord } from "../domain/forum-thread";
import type { ActiveForumReply } from "../domain/forum-reply";
import { validateReplyBody } from "../domain/reply-content";

const FORUM_THREADS_COLLECTION = "forumThreads";
const FORUM_REPLIES_COLLECTION = "forumReplies";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** The reply-count threshold `createReply` enforces at creation time (docs/features/team-forum/SPEC.md — BR-52). */
export const REPLY_CAPACITY_LIMIT = 500;

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore `CollectionReference` and by an in-memory fake in tests. No id
 * is returned — SPEC "Reply capacity" explains why `createReply` needs none
 * (the 500-reply cap already guarantees every reply stays addressable
 * through `getThreadWithReplies`'s always-complete result set).
 */
export interface ForumRepliesCollection {
  add(record: ActiveForumReply): Promise<void>;
}

function getDefaultForumRepliesCollection(): ForumRepliesCollection {
  return {
    async add(record) {
      await getFirestoreDb().collection(FORUM_REPLIES_COLLECTION).add(record);
    },
  };
}

/** The read seam for a real `teamMemberships/{uid}__{teamId}` record — same shape as `createThread`'s (BR-1). */
export interface MembershipReader {
  getMembership(uid: string, teamId: string): Promise<unknown>;
}

function getDefaultMembershipReader(): MembershipReader {
  return {
    async getMembership(uid, teamId) {
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .doc(membershipDocId(uid, teamId))
        .get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

/** The read seam for the owning team's fresh `status` — same shape as `createThread`'s (BR-7). */
export interface TeamStatusReader {
  getTeamStatus(teamId: string): Promise<unknown>;
}

function getDefaultTeamStatusReader(): TeamStatusReader {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

/**
 * The read seam for the target thread's own document, satisfied in
 * production by a Firestore document read and by an in-memory fake in
 * tests. Returns raw, unvalidated data (`undefined` if no such document
 * exists) — `createReply` is responsible for validating it before trusting
 * it.
 */
export interface ThreadReader {
  getThread(threadId: string): Promise<unknown>;
}

function getDefaultThreadReader(): ThreadReader {
  return {
    async getThread(threadId) {
      const snapshot = await getFirestoreDb().collection(FORUM_THREADS_COLLECTION).doc(threadId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

/**
 * The read seam for the target thread's current reply count, satisfied in
 * production by a Firestore `.count()` aggregation query (`where("threadId",
 * "==", threadId)` — no composite index needed, SPEC "Firestore/index
 * implications") and by an in-memory fake in tests.
 */
export interface ReplyCountReader {
  countRepliesForThread(threadId: string): Promise<number>;
}

function getDefaultReplyCountReader(): ReplyCountReader {
  return {
    async countRepliesForThread(threadId) {
      const snapshot = await getFirestoreDb()
        .collection(FORUM_REPLIES_COLLECTION)
        .where("threadId", "==", threadId)
        .count()
        .get();
      return snapshot.data().count;
    },
  };
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
        | "invalid_input"
        | "forbidden"
        | "team_disabled"
        | "not_found"
        | "thread_full"
        | "encryption_failed"
        | "persistence_failed";
    };

export interface CreateReplyDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  membershipReader?: MembershipReader;
  teamStatusReader?: TeamStatusReader;
  threadReader?: ThreadReader;
  replyCountReader?: ReplyCountReader;
  collection?: ForumRepliesCollection;
}

/**
 * Creates one reply to `threadId` within `teamId` (docs/features/team-forum/
 * SPEC.md — "Server operations" → `createReply`; BR-1, BR-2, BR-4, BR-5,
 * BR-6, BR-7, BR-8, BR-9, BR-35, BR-47, BR-52, BR-53). `teamId`/`threadId`
 * are always the caller's trusted route scope; `authorUid` is always the
 * verified caller's own `uid` — never client-supplied.
 *
 * Order of checks, in this exact sequence (SPEC — "Server operations"):
 * verify the ID token (`sign_in_required`) → validate `rawBody` (TASK-001's
 * `validateReplyBody`, `invalid_input`, nothing read/written yet) → confirm a
 * real `teamMemberships/{uid}__{teamId}` record exists (BR-1, mirrors
 * `createThread`'s identical handling — app-admin status alone is never
 * sufficient) → re-read `teams/{teamId}.status` fresh (rejected
 * `team_disabled` for anything other than `active`, including a nonexistent
 * or status-malformed team — BR-7; the API/DTO contract table folds every
 * such case into the single `team_disabled` outcome for this operation,
 * unlike `createThread`'s separate `team_not_found`) → fetch
 * `forumThreads/{threadId}` and validate it (TASK-001's `isValidForumThread`);
 * missing, malformed, or a mismatched `teamId` all resolve to the identical
 * `not_found` (BR-8 — a thread has no separate "deleted" shape to check for
 * anymore; missing *is* deleted) → count the thread's current replies via a
 * Firestore count-aggregation query; `>= 500` → `thread_full` (BR-52),
 * nothing written → encrypt the body (fresh IV) → persist one
 * `forumReplies/{auto-id}` document, with `teamId` always read from the
 * already-validated thread record (BR-35), never from a client-supplied
 * value.
 *
 * No Firestore transaction is used — the reply cap is enforced on a
 * best-effort basis (BR-53), and no other cross-document invariant exists to
 * protect (SPEC "Server operations").
 *
 * Returns `{ok: true}` only — no `replyId`, since `getThreadWithReplies`
 * always returns the thread's complete reply set (SPEC "Reply capacity").
 *
 * Fails closed on every infrastructure failure: a Firestore read/write error
 * maps to `persistence_failed`; an `encrypt` failure (e.g. missing
 * `ENCRYPTION_KEY`) maps to `encryption_failed` — neither path ever falls
 * back to plaintext, and neither is ever logged with any detail from the
 * thrown error (BR-36).
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
    return { ok: false, error: "sign_in_required" };
  }

  const validatedBody = validateReplyBody(rawBody);
  if (!validatedBody.ok) {
    return { ok: false, error: "invalid_input" };
  }

  const membershipReader = deps.membershipReader ?? getDefaultMembershipReader();
  let rawMembership: unknown;
  try {
    rawMembership = await membershipReader.getMembership(verified.identity.uid, teamId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const isMember = isValidMembershipFor(rawMembership, { uid: verified.identity.uid, teamId });
  if (!isMember) {
    return { ok: false, error: "forbidden" };
  }

  const teamStatusReader = deps.teamStatusReader ?? getDefaultTeamStatusReader();
  let rawTeamStatus: unknown;
  try {
    rawTeamStatus = await teamStatusReader.getTeamStatus(teamId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (!isValidTeamStatus(rawTeamStatus) || rawTeamStatus !== "active") {
    // Covers "disabled", "nonexistent" (Firestore returns `undefined`), and
    // any other malformed/unrecognized status uniformly (BR-7) — this
    // operation's documented API/DTO contract has no distinct
    // `team_not_found` outcome, unlike `createThread`'s.
    return { ok: false, error: "team_disabled" };
  }

  const threadReader = deps.threadReader ?? getDefaultThreadReader();
  let rawThread: unknown;
  try {
    rawThread = await threadReader.getThread(threadId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const candidateThread = toCandidateThread(rawThread);
  if (!isValidForumThread(candidateThread) || candidateThread.teamId !== teamId) {
    // Missing, malformed, and cross-team all resolve to the identical
    // not_found (BR-8) — a thread has no separate "deleted" shape to
    // distinguish from "never existed" or "corrupt".
    return { ok: false, error: "not_found" };
  }
  const thread: ForumThreadRecord = candidateThread;

  const replyCountReader = deps.replyCountReader ?? getDefaultReplyCountReader();
  let currentReplyCount: number;
  try {
    currentReplyCount = await replyCountReader.countRepliesForThread(threadId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (currentReplyCount >= REPLY_CAPACITY_LIMIT) {
    return { ok: false, error: "thread_full" };
  }

  let encrypted;
  try {
    encrypted = encrypt(validatedBody.body);
  } catch {
    return { ok: false, error: "encryption_failed" };
  }

  const record: ActiveForumReply = {
    teamId: thread.teamId,
    threadId,
    authorUid: verified.identity.uid,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    createdAt: deps.now ?? new Date(),
  };

  const collection = deps.collection ?? getDefaultForumRepliesCollection();
  try {
    await collection.add(record);
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

import "server-only";
import type { EncryptedPayload } from "../../../lib/encryption/encryption";
import { decrypt } from "../../../lib/encryption/encryption";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "../../teams/server/authorize-team-access";
import { authorTag } from "../domain/author-tag";
import { isValidForumThread } from "../domain/forum-thread";
import { isForumReplyDeleted, isValidForumReply } from "../domain/forum-reply";

const FORUM_THREADS_COLLECTION = "forumThreads";
const FORUM_REPLIES_COLLECTION = "forumReplies";

/**
 * A defensive safety cap on `getThreadWithReplies`'s reply query (docs/
 * features/team-forum/SPEC.md — "Server operations" → `getThreadWithReplies`).
 * `createReply`'s `REPLY_CAPACITY_LIMIT` (also 500) already keeps a thread's
 * real reply count at or near this number in normal operation — this limit
 * only guards against BR-53's rare over-cap race ever producing a query
 * result this operation isn't designed to handle, not the primary bounding
 * mechanism.
 */
export const THREAD_REPLIES_LIMIT = 500;

/**
 * The minimal, response-minimized DTO for a thread's own content (docs/
 * features/team-forum/SPEC.md — "API/DTO contract"). Excludes `authorUid`
 * and every encrypted field — a reader sees only `authorTag`/`isOwnThread`
 * (BR-13).
 */
export interface ThreadDetailView {
  threadId: string;
  title: string;
  body: string;
  authorTag: string;
  isOwnThread: boolean;
  createdAt: string;
}

/**
 * A reply's response DTO (docs/features/team-forum/SPEC.md — "API/DTO
 * contract") — a discriminated union mirroring TASK-001's active/tombstone
 * split. A tombstoned reply carries no `body`/`authorTag`/`isOwnReply`
 * information at all (`null`/`false`), never the original content.
 */
export type ReplyView =
  | {
      replyId: string;
      isDeleted: false;
      body: string;
      authorTag: string;
      isOwnReply: boolean;
      createdAt: string;
    }
  | {
      replyId: string;
      isDeleted: true;
      body: null;
      authorTag: null;
      isOwnReply: false;
      createdAt: string;
    };

/** One raw `forumReplies` document, paired with its Firestore-assigned id (never itself part of the stored fields). */
export interface RawReplyDoc {
  id: string;
  data: unknown;
}

/**
 * The read seam for the target thread's own document — same shape as
 * `createReply`'s `ThreadReader`. Returns raw, unvalidated data (`undefined`
 * if no such document exists).
 */
export interface ForumThreadReader {
  getThread(threadId: string): Promise<unknown>;
}

function getDefaultForumThreadReader(): ForumThreadReader {
  return {
    async getThread(threadId) {
      const snapshot = await getFirestoreDb().collection(FORUM_THREADS_COLLECTION).doc(threadId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

/**
 * The read seam for a thread's replies, satisfied in production by a
 * Firestore query (`threadId == threadId`, `orderBy("createdAt", "asc")`,
 * `limit(500)`) and by an in-memory fake in tests. Returns raw, unvalidated
 * documents in the query's own (oldest-first) order — validation,
 * tombstone-classification, and decryption all happen entirely in
 * `getThreadWithReplies`, never here.
 */
export interface ForumRepliesReader {
  listOrderedForThread(threadId: string): Promise<RawReplyDoc[]>;
}

function getDefaultForumRepliesReader(): ForumRepliesReader {
  return {
    async listOrderedForThread(threadId) {
      const snapshot = await getFirestoreDb()
        .collection(FORUM_REPLIES_COLLECTION)
        .where("threadId", "==", threadId)
        .orderBy("createdAt", "asc")
        .limit(THREAD_REPLIES_LIMIT)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
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
  // Left as-is (not a Date) so the validator's date check fails closed on
  // it, rather than silently coercing an unexpected shape.
  return value;
}

/** Maps raw Firestore thread document data (a Timestamp `createdAt` included) into the candidate shape `isValidForumThread` expects. */
function toCandidateThread(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  return { ...record, createdAt: toDateOrUndefined(record.createdAt) };
}

/**
 * Maps raw Firestore reply document data (`createdAt`, and — only if
 * present — `deletedAt`, both possibly Firestore Timestamps) into the
 * candidate shape `isValidForumReply` expects. Deliberately does not add a
 * `deletedAt` key when the source document has none, so the active/
 * tombstone shape discrimination (`"deletedAt" in record`) is preserved
 * exactly rather than corrupted by an added-but-undefined field.
 */
function toCandidateReply(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  const candidate: Record<string, unknown> = { ...record, createdAt: toDateOrUndefined(record.createdAt) };
  if ("deletedAt" in record) {
    candidate.deletedAt = toDateOrUndefined(record.deletedAt);
  }
  return candidate;
}

interface DecryptedThreadContent {
  title: string;
  body: string;
}

/**
 * Parses and validates a thread's decrypted JSON payload — same rules as
 * `listTeamThreads`'s identical helper (SPEC — "Data model" → "Why one
 * combined `ciphertext`..."). A decrypted-but-malformed payload is treated
 * identically to any other malformed record.
 */
function parseThreadContent(raw: string): DecryptedThreadContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.body !== "string") {
    return null;
  }

  return { title: record.title, body: record.body };
}

export type GetThreadWithRepliesResult =
  | { ok: true; thread: ThreadDetailView; replies: ReplyView[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "not_found" | "read_failed" };

export interface GetThreadWithRepliesDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  authCollection?: AuthorizeTeamAccessDeps["collection"];
  threadReader?: ForumThreadReader;
  repliesReader?: ForumRepliesReader;
  decryptContent?: (payload: EncryptedPayload) => string;
}

/**
 * Backs a team's thread detail view (docs/features/team-forum/SPEC.md —
 * BR-16, BR-17, BR-18, BR-19, BR-20, BR-26, BR-34, BR-35, BR-52, BR-56).
 * Requires the same `authorizeTeamAccess` boundary as `listTeamThreads`
 * (`"admin"`/`"member"` required; `"denied"` → `forbidden`; a `read_failed`
 * from the check itself is never collapsed into `forbidden`).
 *
 * A `threadId` that does not exist, or whose persisted `teamId` doesn't
 * match the route scope, resolves to the identical `not_found` in every
 * case (BR-16). A thread document that exists but fails validation (missing/
 * wrong-typed field, undecryptable/malformed-JSON ciphertext) fails the
 * *whole call* closed as `read_failed` (BR-20) — never fabricates thread
 * content from an untrustworthy record.
 *
 * Replies are queried `threadId == threadId`, `orderBy("createdAt", "asc")`,
 * `limit(500)` — oldest-first (BR-17), and — because `createReply`'s
 * BR-52 cap keeps a thread's real count at or under this limit in normal
 * operation — always the thread's *complete* reply set, never a truncated
 * window (BR-19). Per raw reply document: fail-closed validation
 * (`isValidForumReply`, TASK-001, BR-56) excludes any shape that is neither
 * a well-formed active reply nor a well-formed tombstone; a cross-check of
 * the reply's own persisted `teamId` against the *thread's* `teamId`
 * excludes a corrupted cross-team reply (BR-35); a well-formed tombstone is
 * mapped directly to a content-free `ReplyView` at its original position
 * without ever calling `decrypt` (BR-26 — there is no `ciphertext` field on
 * a tombstone to pass to it); a well-formed active reply is decrypted and
 * mapped to a full `ReplyView`.
 */
export async function getThreadWithReplies(
  idToken: string,
  teamId: string,
  threadId: string,
  deps: GetThreadWithRepliesDeps = {},
): Promise<GetThreadWithRepliesResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const authResult = await authorizeTeamAccess(verified.identity, teamId, {
    allowList: deps.allowList,
    collection: deps.authCollection,
  });
  if (!authResult.ok) {
    return { ok: false, error: "read_failed" };
  }
  if (authResult.access === "denied") {
    return { ok: false, error: "forbidden" };
  }

  const threadReader = deps.threadReader ?? getDefaultForumThreadReader();
  let rawThread: unknown;
  try {
    rawThread = await threadReader.getThread(threadId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  if (rawThread === undefined) {
    return { ok: false, error: "not_found" };
  }

  const candidateThread = toCandidateThread(rawThread);
  if (!isValidForumThread(candidateThread)) {
    // An existing-but-malformed thread document fails the whole call closed
    // (BR-20) — distinct from a genuinely missing document, handled above.
    return { ok: false, error: "read_failed" };
  }
  if (candidateThread.teamId !== teamId) {
    return { ok: false, error: "not_found" };
  }

  const decryptContent = deps.decryptContent ?? decrypt;

  let threadContent: DecryptedThreadContent | null;
  try {
    const decrypted = decryptContent({
      ciphertext: candidateThread.ciphertext,
      iv: candidateThread.iv,
      authTag: candidateThread.authTag,
      keyVersion: candidateThread.keyVersion,
    });
    threadContent = parseThreadContent(decrypted);
  } catch {
    threadContent = null;
  }
  if (threadContent === null) {
    return { ok: false, error: "read_failed" };
  }

  const repliesReader = deps.repliesReader ?? getDefaultForumRepliesReader();
  let rawReplies: RawReplyDoc[];
  try {
    rawReplies = await repliesReader.listOrderedForThread(threadId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const replies: ReplyView[] = [];

  for (const { id, data } of rawReplies) {
    const candidate = toCandidateReply(data);
    if (!isValidForumReply(candidate)) {
      // Neither a well-formed active nor a well-formed tombstone shape
      // (BR-56) — excluded entirely, never guessed at.
      continue;
    }

    if (candidate.teamId !== candidateThread.teamId) {
      // Defense-in-depth: never trust the reader's own query scoping alone
      // (BR-35) — a reply whose own persisted teamId doesn't match its
      // parent thread's teamId is excluded even if the reader returned it.
      continue;
    }

    if (isForumReplyDeleted(candidate)) {
      // A tombstone has no ciphertext field at all — nothing to decrypt.
      replies.push({
        replyId: id,
        isDeleted: true,
        body: null,
        authorTag: null,
        isOwnReply: false,
        createdAt: candidate.createdAt.toISOString(),
      });
      continue;
    }

    let replyBody: string;
    try {
      replyBody = decryptContent({
        ciphertext: candidate.ciphertext,
        iv: candidate.iv,
        authTag: candidate.authTag,
        keyVersion: candidate.keyVersion,
      });
    } catch {
      // Skip, don't throw or fall back to ciphertext (BR-20) — never
      // logged, since the thrown error could echo ciphertext/IV bytes.
      continue;
    }

    replies.push({
      replyId: id,
      isDeleted: false,
      body: replyBody,
      authorTag: authorTag(teamId, candidate.authorUid),
      isOwnReply: candidate.authorUid === verified.identity.uid,
      createdAt: candidate.createdAt.toISOString(),
    });
  }

  return {
    ok: true,
    thread: {
      threadId,
      title: threadContent.title,
      body: threadContent.body,
      authorTag: authorTag(teamId, candidateThread.authorUid),
      isOwnThread: candidateThread.authorUid === verified.identity.uid,
      createdAt: candidateThread.createdAt.toISOString(),
    },
    replies,
  };
}

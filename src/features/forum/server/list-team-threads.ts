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
import { isValidForumThread, type ForumThreadRecord } from "../domain/forum-thread";

const FORUM_THREADS_COLLECTION = "forumThreads";

/** The maximum number of threads `listTeamThreads` ever returns (SPEC — BR-19, BR-34). */
export const LIST_TEAM_THREADS_LIMIT = 200;

/**
 * The minimal, response-minimized DTO returned by `listTeamThreads`
 * (docs/features/team-forum/SPEC.md — "API/DTO contract"). Deliberately
 * excludes `authorUid` and every encrypted field — a reader sees only
 * `authorTag` and `isOwnThread` (BR-13). `createdAt` is a full-precision ISO
 * timestamp (no date-only truncation, unlike Anonymous Challenges — see
 * SPEC "No time-of-day minimization, unlike Anonymous Challenges").
 */
export interface ThreadSummaryView {
  threadId: string;
  title: string;
  authorTag: string;
  isOwnThread: boolean;
  createdAt: string;
}

/** One raw `forumThreads` document, paired with its Firestore-assigned id (never itself part of the stored fields). */
export interface RawThreadDoc {
  id: string;
  data: unknown;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore query (`teamId == teamId`, `orderBy("createdAt", "desc")`,
 * `limit(200)`) and by an in-memory fake in tests. Returns raw, unvalidated
 * documents in the query's own order — validation/decryption happen
 * entirely in `listTeamThreads`, never here.
 */
export interface ThreadsReader {
  listRecentForTeam(teamId: string): Promise<RawThreadDoc[]>;
}

function getDefaultThreadsReader(): ThreadsReader {
  return {
    async listRecentForTeam(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(FORUM_THREADS_COLLECTION)
        .where("teamId", "==", teamId)
        .orderBy("createdAt", "desc")
        .limit(LIST_TEAM_THREADS_LIMIT)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
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
  // Left as-is (not a Date) so `isValidForumThread`'s `isValidDate` check
  // fails closed on it, rather than silently coercing an unexpected shape.
  return value;
}

interface DecryptedThreadContent {
  title: string;
  body: string;
}

/**
 * Parses and validates a thread's decrypted JSON payload (SPEC — "Data
 * model" → "Why one combined `ciphertext`..."). A decrypted-but-malformed
 * payload (not JSON, not an object, or missing/wrong-typed `title`/`body`)
 * is treated identically to any other malformed record — excluded, never
 * partially trusted.
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

export type ListTeamThreadsResult =
  | { ok: true; threads: ThreadSummaryView[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface ListTeamThreadsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  authCollection?: AuthorizeTeamAccessDeps["collection"];
  reader?: ThreadsReader;
  decryptContent?: (payload: EncryptedPayload) => string;
}

/**
 * Backs `/teams/[teamId]`'s forum thread list (docs/features/team-forum/
 * SPEC.md — BR-15, BR-18, BR-19, BR-20, BR-21, BR-34). Requires
 * `authorizeTeamAccess` to resolve to `"admin"` or `"member"` for `teamId`
 * — the same broader viewing boundary `listTeamChallengesForMember` already
 * uses; `"denied"` is rejected `forbidden`, and a `read_failed` result from
 * the authorization check itself is never collapsed into `forbidden`.
 *
 * No `teams/{teamId}.status` gate — a disabled team's existing threads
 * remain listable (BR-21).
 *
 * Processing order per raw document (SPEC — "Server operations" →
 * `listTeamThreads`; the order itself is the privacy/correctness
 * guarantee): validate (`isValidForumThread`, TASK-001, fail-closed; skip on
 * failure) → cross-check the validated record's own `teamId` against the
 * requested `teamId` (defense-in-depth, BR-18 — the query's own scoping is
 * never trusted alone) → decrypt `{title, body}` (skip on a decryption or
 * malformed-JSON failure, same as a malformed document) → compute
 * `authorTag(teamId, authorUid)` (TASK-001) and `isOwnThread` → map to
 * `ThreadSummaryView`. There is no `isForumThreadDeleted` check anywhere in
 * this function — a thread returned by the underlying query is
 * definitionally not deleted, since `deleteThread` (TASK-004) removes the
 * document entirely; a deleted thread cannot be a member of the reader's
 * result set.
 *
 * Returns threads in the reader's own order (newest-first, already bounded
 * to the 200 most recent by the query itself, BR-19/BR-34) — no
 * application-level re-sort or re-slice.
 */
export async function listTeamThreads(
  idToken: string,
  teamId: string,
  deps: ListTeamThreadsDeps = {},
): Promise<ListTeamThreadsResult> {
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

  const reader = deps.reader ?? getDefaultThreadsReader();
  let rawDocs: RawThreadDoc[];
  try {
    rawDocs = await reader.listRecentForTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const decryptContent = deps.decryptContent ?? decrypt;
  const threads: ThreadSummaryView[] = [];

  for (const { id, data } of rawDocs) {
    const candidate = toCandidateThread(data);
    if (!isValidForumThread(candidate)) {
      continue;
    }

    const record: ForumThreadRecord = candidate;
    // Defense-in-depth: never trust the reader's own query scoping alone
    // (BR-18) — a document whose persisted `teamId` doesn't match the
    // requested scope is excluded even if the reader returned it.
    if (record.teamId !== teamId) {
      continue;
    }

    let content: DecryptedThreadContent | null;
    try {
      const decrypted = decryptContent({
        ciphertext: record.ciphertext,
        iv: record.iv,
        authTag: record.authTag,
        keyVersion: record.keyVersion,
      });
      content = parseThreadContent(decrypted);
    } catch {
      // Skip, don't throw or fall back to ciphertext (BR-20) — never
      // logged, since the thrown error could echo ciphertext/IV bytes.
      content = null;
    }
    if (content === null) {
      continue;
    }

    threads.push({
      threadId: id,
      title: content.title,
      authorTag: authorTag(teamId, record.authorUid),
      isOwnThread: record.authorUid === verified.identity.uid,
      createdAt: record.createdAt.toISOString(),
    });
  }

  return { ok: true, threads };
}

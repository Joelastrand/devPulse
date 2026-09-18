/**
 * Client gateway for `/teams/[teamId]`'s forum section and thread-detail
 * view (docs/features/team-forum/SPEC.md — TASK-005). Thin `fetch` wrappers
 * around `/api/teams/[teamId]/forum/...`, mirroring
 * `challenges-gateway.ts`/`admin-challenges-gateway.ts`'s established
 * shape-validation-before-trust convention — a malformed or unexpected
 * response body always falls back to a controlled `read_failed`/`unknown`,
 * never rendered as if valid. No authorization/lifecycle logic lives here.
 *
 * Every list/detail item is rebuilt field-by-field into a fresh object
 * containing only the approved fields — never the parsed value itself,
 * however well-formed — so an extra `authorUid`/`deletedBy`/encrypted/
 * email-shaped field on the raw payload can never ride along to a component
 * even if a future server bug ever emitted one alongside otherwise-valid
 * fields.
 */

export interface ThreadSummaryView {
  threadId: string;
  title: string;
  authorTag: string;
  isOwnThread: boolean;
  createdAt: string;
}

export interface ThreadDetailView {
  threadId: string;
  title: string;
  body: string;
  authorTag: string;
  isOwnThread: boolean;
  createdAt: string;
}

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function toThreadSummaryView(value: unknown): ThreadSummaryView | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    !isNonEmptyString(record.threadId) ||
    typeof record.title !== "string" ||
    !isNonEmptyString(record.authorTag) ||
    typeof record.isOwnThread !== "boolean" ||
    !isNonEmptyString(record.createdAt)
  ) {
    return undefined;
  }
  return {
    threadId: record.threadId,
    title: record.title,
    authorTag: record.authorTag,
    isOwnThread: record.isOwnThread,
    createdAt: record.createdAt,
  };
}

function toThreadDetailView(value: unknown): ThreadDetailView | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    !isNonEmptyString(record.threadId) ||
    typeof record.title !== "string" ||
    typeof record.body !== "string" ||
    !isNonEmptyString(record.authorTag) ||
    typeof record.isOwnThread !== "boolean" ||
    !isNonEmptyString(record.createdAt)
  ) {
    return undefined;
  }
  return {
    threadId: record.threadId,
    title: record.title,
    body: record.body,
    authorTag: record.authorTag,
    isOwnThread: record.isOwnThread,
    createdAt: record.createdAt,
  };
}

/** Rebuilds one reply item, accepting only its two documented shapes (BR-56's active/tombstone split) — a hybrid or partial candidate is rejected, never guessed at. */
function toReplyView(value: unknown): ReplyView | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.replyId) || typeof record.isDeleted !== "boolean" || !isNonEmptyString(record.createdAt)) {
    return undefined;
  }

  if (record.isDeleted) {
    if (record.body !== null || record.authorTag !== null || record.isOwnReply !== false) {
      return undefined;
    }
    return {
      replyId: record.replyId,
      isDeleted: true,
      body: null,
      authorTag: null,
      isOwnReply: false,
      createdAt: record.createdAt,
    };
  }

  if (typeof record.body !== "string" || !isNonEmptyString(record.authorTag) || typeof record.isOwnReply !== "boolean") {
    return undefined;
  }
  return {
    replyId: record.replyId,
    isDeleted: false,
    body: record.body,
    authorTag: record.authorTag,
    isOwnReply: record.isOwnReply,
    createdAt: record.createdAt,
  };
}

// --- List threads -----------------------------------------------------------

type ReadErrorStatus = "unauthenticated" | "forbidden" | "read_failed";

const KNOWN_READ_ERRORS = new Set<ReadErrorStatus>(["unauthenticated", "forbidden", "read_failed"]);

function isKnownReadError(value: unknown): value is ReadErrorStatus {
  return typeof value === "string" && KNOWN_READ_ERRORS.has(value as ReadErrorStatus);
}

export type FetchTeamThreadsResult =
  | { status: "ok"; threads: ThreadSummaryView[] }
  | { status: ReadErrorStatus };

function parseFetchTeamThreadsResult(value: unknown): FetchTeamThreadsResult {
  if (typeof value !== "object" || value === null) {
    return { status: "read_failed" };
  }
  const record = value as Record<string, unknown>;
  if (record.status === "ok") {
    if (!Array.isArray(record.threads)) {
      return { status: "read_failed" };
    }
    const threads: ThreadSummaryView[] = [];
    for (const item of record.threads) {
      const view = toThreadSummaryView(item);
      if (!view) {
        return { status: "read_failed" };
      }
      threads.push(view);
    }
    return { status: "ok", threads };
  }
  return isKnownReadError(record.status) ? { status: record.status } : { status: "read_failed" };
}

export interface ForumThreadsReadGateway {
  fetchTeamThreads(idToken: string, teamId: string): Promise<FetchTeamThreadsResult>;
}

function getDefaultThreadsReadGateway(): ForumThreadsReadGateway {
  return {
    async fetchTeamThreads(idToken, teamId) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/forum/threads`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        return parseFetchTeamThreadsResult(await parseJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchTeamThreadsDeps {
  gateway?: ForumThreadsReadGateway;
}

/** Fetches `teamId`'s thread list, newest-first, exactly as `listTeamThreads` returned it — no client-side re-sorting or filtering. */
export async function fetchTeamThreads(
  idToken: string,
  teamId: string,
  deps: FetchTeamThreadsDeps = {},
): Promise<FetchTeamThreadsResult> {
  const gateway = deps.gateway ?? getDefaultThreadsReadGateway();
  return gateway.fetchTeamThreads(idToken, teamId);
}

// --- Create thread -----------------------------------------------------------

export type CreateThreadFetchResult =
  | { status: "ok"; threadId: string }
  | {
      status:
        | "invalid_input"
        | "sign_in_required"
        | "forbidden"
        | "team_not_found"
        | "team_disabled"
        | "encryption_failed"
        | "persistence_failed"
        | "read_failed";
    };

const KNOWN_CREATE_THREAD_ERRORS = new Set([
  "invalid_input",
  "sign_in_required",
  "forbidden",
  "team_not_found",
  "team_disabled",
  "encryption_failed",
  "persistence_failed",
]);

export interface CreateThreadGateway {
  createThread(idToken: string, teamId: string, title: string, body: string): Promise<CreateThreadFetchResult>;
}

function getDefaultCreateThreadGateway(): CreateThreadGateway {
  return {
    async createThread(idToken, teamId, title, body) {
      try {
        const response = await fetch(`/api/teams/${encodeURIComponent(teamId)}/forum/threads`, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${idToken}` },
          // Only title/body are ever sent — no authorUid/teamId override/threadId/deletedAt (BR-2, BR-47).
          body: JSON.stringify({ title, body }),
        });

        if (response.status === 201) {
          const parsed = await parseJson(response);
          const threadId =
            typeof parsed === "object" && parsed !== null && "threadId" in parsed
              ? (parsed as { threadId: unknown }).threadId
              : undefined;
          return isNonEmptyString(threadId) ? { status: "ok", threadId } : { status: "read_failed" };
        }

        const parsed = await parseJson(response);
        const error =
          typeof parsed === "object" && parsed !== null && "error" in parsed
            ? (parsed as { error: unknown }).error
            : undefined;

        return typeof error === "string" && KNOWN_CREATE_THREAD_ERRORS.has(error)
          ? { status: error as Exclude<CreateThreadFetchResult["status"], "ok" | "read_failed"> }
          : { status: "read_failed" };
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface CreateThreadDeps {
  gateway?: CreateThreadGateway;
}

/** Creates a thread for `teamId` via the thin `POST .../forum/threads` route. `idToken` is forwarded only for the server to verify; no authorization/eligibility decision is made here. */
export async function createThread(
  idToken: string,
  teamId: string,
  title: string,
  body: string,
  deps: CreateThreadDeps = {},
): Promise<CreateThreadFetchResult> {
  const gateway = deps.gateway ?? getDefaultCreateThreadGateway();
  return gateway.createThread(idToken, teamId, title, body);
}

// --- Thread detail -------------------------------------------------------

export type FetchThreadDetailResult =
  | { status: "ok"; thread: ThreadDetailView; replies: ReplyView[] }
  | { status: ReadErrorStatus | "not_found" };

function parseFetchThreadDetailResult(value: unknown): FetchThreadDetailResult {
  if (typeof value !== "object" || value === null) {
    return { status: "read_failed" };
  }
  const record = value as Record<string, unknown>;
  if (record.status === "ok") {
    const thread = toThreadDetailView(record.thread);
    if (!thread || !Array.isArray(record.replies)) {
      return { status: "read_failed" };
    }
    const replies: ReplyView[] = [];
    for (const item of record.replies) {
      const view = toReplyView(item);
      if (!view) {
        return { status: "read_failed" };
      }
      replies.push(view);
    }
    return { status: "ok", thread, replies };
  }
  return record.status === "unauthenticated" ||
    record.status === "forbidden" ||
    record.status === "not_found" ||
    record.status === "read_failed"
    ? { status: record.status }
    : { status: "read_failed" };
}

export interface ThreadDetailReadGateway {
  fetchThreadDetail(idToken: string, teamId: string, threadId: string): Promise<FetchThreadDetailResult>;
}

function getDefaultThreadDetailReadGateway(): ThreadDetailReadGateway {
  return {
    async fetchThreadDetail(idToken, teamId, threadId) {
      try {
        const response = await fetch(
          `/api/teams/${encodeURIComponent(teamId)}/forum/threads/${encodeURIComponent(threadId)}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseFetchThreadDetailResult(await parseJson(response));
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface FetchThreadDetailDeps {
  gateway?: ThreadDetailReadGateway;
}

/** Fetches one thread's content and every one of its replies, oldest-first, exactly as `getThreadWithReplies` returned them. */
export async function fetchThreadDetail(
  idToken: string,
  teamId: string,
  threadId: string,
  deps: FetchThreadDetailDeps = {},
): Promise<FetchThreadDetailResult> {
  const gateway = deps.gateway ?? getDefaultThreadDetailReadGateway();
  return gateway.fetchThreadDetail(idToken, teamId, threadId);
}

// --- Create reply -------------------------------------------------------

export type CreateReplyFetchResult =
  | { status: "ok" }
  | {
      status:
        | "invalid_input"
        | "sign_in_required"
        | "forbidden"
        | "not_found"
        | "team_disabled"
        | "thread_full"
        | "encryption_failed"
        | "persistence_failed"
        | "read_failed";
    };

const KNOWN_CREATE_REPLY_ERRORS = new Set([
  "invalid_input",
  "sign_in_required",
  "forbidden",
  "not_found",
  "team_disabled",
  "thread_full",
  "encryption_failed",
  "persistence_failed",
]);

export interface CreateReplyGateway {
  createReply(idToken: string, teamId: string, threadId: string, body: string): Promise<CreateReplyFetchResult>;
}

function getDefaultCreateReplyGateway(): CreateReplyGateway {
  return {
    async createReply(idToken, teamId, threadId, body) {
      try {
        const response = await fetch(
          `/api/teams/${encodeURIComponent(teamId)}/forum/threads/${encodeURIComponent(threadId)}/replies`,
          {
            method: "POST",
            headers: { "content-type": "application/json", Authorization: `Bearer ${idToken}` },
            // Only the reply body is ever sent — no authorUid/teamId/threadId override/deletedAt (BR-2, BR-47).
            body: JSON.stringify({ body }),
          },
        );

        if (response.status === 201) {
          return { status: "ok" };
        }

        const parsed = await parseJson(response);
        const error =
          typeof parsed === "object" && parsed !== null && "error" in parsed
            ? (parsed as { error: unknown }).error
            : undefined;

        return typeof error === "string" && KNOWN_CREATE_REPLY_ERRORS.has(error)
          ? { status: error as Exclude<CreateReplyFetchResult["status"], "ok" | "read_failed"> }
          : { status: "read_failed" };
      } catch {
        return { status: "read_failed" };
      }
    },
  };
}

export interface CreateReplyDeps {
  gateway?: CreateReplyGateway;
}

/** Submits a reply to `threadId` via the thin `POST .../replies` route. No authorization/capacity decision is made here — the server always re-derives everything fresh. */
export async function createReply(
  idToken: string,
  teamId: string,
  threadId: string,
  body: string,
  deps: CreateReplyDeps = {},
): Promise<CreateReplyFetchResult> {
  const gateway = deps.gateway ?? getDefaultCreateReplyGateway();
  return gateway.createReply(idToken, teamId, threadId, body);
}

// --- Delete thread / delete reply -----------------------------------------

export type ForumManagementActionResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "forbidden" | "not_found" | "persistence_failed" | "unknown" };

function parseManagementActionResponse(status: number, body: unknown): ForumManagementActionResult {
  if (status === 200 && typeof body === "object" && body !== null) {
    const { ok } = body as { ok: unknown };
    if (ok === true) {
      return { ok: true };
    }
  }
  if (status === 401) return { ok: false, error: "unauthenticated" };
  if (status === 403) return { ok: false, error: "forbidden" };
  if (status === 404) return { ok: false, error: "not_found" };
  if (status === 500) return { ok: false, error: "persistence_failed" };
  return { ok: false, error: "unknown" };
}

export interface DeleteThreadGateway {
  deleteThread(idToken: string, teamId: string, threadId: string): Promise<ForumManagementActionResult>;
}

function getDefaultDeleteThreadGateway(): DeleteThreadGateway {
  return {
    async deleteThread(idToken, teamId, threadId) {
      try {
        const response = await fetch(
          `/api/teams/${encodeURIComponent(teamId)}/forum/threads/${encodeURIComponent(threadId)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseManagementActionResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface DeleteThreadDeps {
  gateway?: DeleteThreadGateway;
}

/** Permanently deletes a thread (and every one of its replies) for its own author or an app admin. No confirmation/identity data is sent — the confirmation step is a UI-only gate before this call fires. */
export async function deleteThread(
  idToken: string,
  teamId: string,
  threadId: string,
  deps: DeleteThreadDeps = {},
): Promise<ForumManagementActionResult> {
  const gateway = deps.gateway ?? getDefaultDeleteThreadGateway();
  return gateway.deleteThread(idToken, teamId, threadId);
}

export interface DeleteReplyGateway {
  deleteReply(
    idToken: string,
    teamId: string,
    threadId: string,
    replyId: string,
  ): Promise<ForumManagementActionResult>;
}

function getDefaultDeleteReplyGateway(): DeleteReplyGateway {
  return {
    async deleteReply(idToken, teamId, threadId, replyId) {
      try {
        const response = await fetch(
          `/api/teams/${encodeURIComponent(teamId)}/forum/threads/${encodeURIComponent(threadId)}/replies/${encodeURIComponent(replyId)}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } },
        );
        return parseManagementActionResponse(response.status, await parseJson(response));
      } catch {
        return { ok: false, error: "unknown" };
      }
    },
  };
}

export interface DeleteReplyDeps {
  gateway?: DeleteReplyGateway;
}

/** Tombstones one reply for its own author, an app admin, or (idempotently, per BR-27) any authenticated caller retrying an already-tombstoned reply. */
export async function deleteReply(
  idToken: string,
  teamId: string,
  threadId: string,
  replyId: string,
  deps: DeleteReplyDeps = {},
): Promise<ForumManagementActionResult> {
  const gateway = deps.gateway ?? getDefaultDeleteReplyGateway();
  return gateway.deleteReply(idToken, teamId, threadId, replyId);
}

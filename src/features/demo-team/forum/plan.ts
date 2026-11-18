import type { RecordEnvelope } from "../../../lib/encryption/record-envelope";
import { forumThreadContext } from "../../forum/domain/forum-thread";
import { forumReplyContext } from "../../forum/domain/forum-reply";
import type { ProvisionDecision } from "../identities/plan";
import { buildForumReplyDocument, buildForumThreadDocument, type DemoForumThread, type ForumSealer } from "./fixtures";
import { membershipDocId } from "../../teams/domain/team-membership";

/**
 * Pure classification for the forum fixtures (Phase D). Per record: `create` (absent), `skip` (present and its sealed content
 * and metadata equal the fixture exactly, so the existing ciphertext is kept and never rewritten), or `conflict` (anything
 * else, including an unreadable record). It never writes and never throws. Conflict reasons are fixed categories.
 */

/** Observed raw document, or `undefined` when absent. */
export type ObservedDoc = unknown;

export interface ObservedForumRecords {
  threads: ReadonlyMap<string, ObservedDoc>;
  replies: ReadonlyMap<string, ObservedDoc>;
}

/** Opens a sealed envelope under a context. Returns `null` on any failure (never throws). */
export type ForumOpener = (envelope: RecordEnvelope, context: string) => string | null;

function timeOf(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  return null;
}

function metadataMatches(existing: Record<string, unknown>, expected: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => {
    if (key === "createdAt") return timeOf(existing.createdAt) !== null && timeOf(existing.createdAt) === timeOf(expected.createdAt);
    return existing[key] === expected[key];
  });
}

function envelopeOf(record: Record<string, unknown>): RecordEnvelope | null {
  const { ciphertext, iv, authTag, keyVersion, keyId } = record;
  if (typeof ciphertext !== "string" || typeof iv !== "string" || typeof authTag !== "string") return null;
  if (typeof keyVersion !== "string" || typeof keyId !== "string") return null;
  return { ciphertext, iv, authTag, keyVersion, keyId } as RecordEnvelope;
}

const THREAD_KEYS = ["teamId", "authorUid", "createdAt"] as const;
const REPLY_KEYS = ["teamId", "threadId", "authorUid", "createdAt"] as const;

export function classifyForumThread(
  thread: DemoForumThread,
  teamId: string,
  observed: ObservedDoc,
  seal: ForumSealer,
  open: ForumOpener,
): ProvisionDecision {
  if (observed === undefined) return { action: "create" };
  if (typeof observed !== "object" || observed === null) return { action: "conflict", reason: "malformed" };
  const existing = observed as Record<string, unknown>;
  if ("deletedAt" in existing) return { action: "conflict", reason: "tombstone-present" };

  const expected = buildForumThreadDocument(thread, teamId, seal) as unknown as Record<string, unknown>;
  if (!metadataMatches(existing, expected, THREAD_KEYS)) return { action: "conflict", reason: "metadata-differs" };
  const envelope = envelopeOf(existing);
  if (envelope === null) return { action: "conflict", reason: "malformed" };
  const opened = open(envelope, forumThreadContext(teamId, thread.threadId));
  if (opened === null) return { action: "conflict", reason: "undecryptable" };
  let content: unknown;
  try {
    content = JSON.parse(opened);
  } catch {
    return { action: "conflict", reason: "undecryptable" };
  }
  const same =
    typeof content === "object" &&
    content !== null &&
    (content as { title?: unknown }).title === thread.title &&
    (content as { body?: unknown }).body === thread.body;
  return same ? { action: "skip" } : { action: "conflict", reason: "content-differs" };
}

export function classifyForumReply(
  reply: DemoForumThread["replies"][number],
  thread: DemoForumThread,
  teamId: string,
  observed: ObservedDoc,
  seal: ForumSealer,
  open: ForumOpener,
): ProvisionDecision {
  if (observed === undefined) return { action: "create" };
  if (typeof observed !== "object" || observed === null) return { action: "conflict", reason: "malformed" };
  const existing = observed as Record<string, unknown>;
  if ("deletedAt" in existing) return { action: "conflict", reason: "tombstone-present" };

  const expected = buildForumReplyDocument(reply, thread, teamId, seal) as unknown as Record<string, unknown>;
  if (!metadataMatches(existing, expected, REPLY_KEYS)) return { action: "conflict", reason: "metadata-differs" };
  const envelope = envelopeOf(existing);
  if (envelope === null) return { action: "conflict", reason: "malformed" };
  const opened = open(envelope, forumReplyContext(teamId, thread.threadId, reply.replyId));
  if (opened === null) return { action: "conflict", reason: "undecryptable" };
  return opened === reply.body ? { action: "skip" } : { action: "conflict", reason: "content-differs" };
}

export interface ForumPlanItem {
  kind: "thread" | "reply";
  docId: string;
  decision: ProvisionDecision;
  path: string;
}

export interface ForumProvisioningPlan {
  items: ForumPlanItem[];
  counts: Record<"create" | "skip" | "conflict", number>;
  /** `true` only when nothing conflicts. A plan with any conflict is never written. */
  noConflicts: boolean;
}

export function membershipRefPath(uid: string, teamId: string): string {
  return `teamMemberships/${membershipDocId(uid, teamId)}`;
}

/** A fixture author must hold an ordinary, live membership of the target team (uid and team match; role absent). */
export function authorMembershipOk(raw: unknown, uid: string, teamId: string): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const record = raw as Record<string, unknown>;
  return record.uid === uid && record.teamId === teamId && record.role === undefined;
}

export function planForumProvisioning(input: {
  threads: readonly DemoForumThread[];
  teamId: string;
  observed: ObservedForumRecords;
  seal: ForumSealer;
  open: ForumOpener;
}): ForumProvisioningPlan {
  const items: ForumPlanItem[] = [];
  for (const thread of input.threads) {
    items.push({
      kind: "thread",
      docId: thread.threadId,
      path: `forumThreads/${thread.threadId}`,
      decision: classifyForumThread(thread, input.teamId, input.observed.threads.get(thread.threadId), input.seal, input.open),
    });
    for (const reply of thread.replies) {
      items.push({
        kind: "reply",
        docId: reply.replyId,
        path: `forumReplies/${reply.replyId}`,
        decision: classifyForumReply(reply, thread, input.teamId, input.observed.replies.get(reply.replyId), input.seal, input.open),
      });
    }
  }
  const counts: ForumProvisioningPlan["counts"] = { create: 0, skip: 0, conflict: 0 };
  for (const item of items) counts[item.decision.action] += 1;
  return { items, counts, noConflicts: counts.conflict === 0 };
}

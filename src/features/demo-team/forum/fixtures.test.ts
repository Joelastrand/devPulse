import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES } from "../identities/fixtures";
import { forumReplyContext } from "../../forum/domain/forum-reply";
import { forumThreadContext } from "../../forum/domain/forum-thread";
import { isValidForumThread } from "../../forum/domain/forum-thread";
import { isValidForumReply } from "../../forum/domain/forum-reply";
import {
  DEMO_FORUM_THREADS,
  buildForumReplyDocument,
  buildForumThreadDocument,
  validateDemoForumThreads,
  type DemoForumThread,
} from "./fixtures";

const AS_OF = new Date("2026-11-16T00:00:00.000Z");
const TEAM = "8yB2bS8Jav69TCfDETON";
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64")));
afterEach(() => vi.unstubAllEnvs());

function clone(threads: readonly DemoForumThread[]): DemoForumThread[] {
  return threads.map((thread) => ({ ...thread, replies: thread.replies.map((reply) => ({ ...reply })) }));
}

describe("forum fixtures: shape and counts", () => {
  it("defines 8 to 12 threads and 20 to 30 replies, all valid", () => {
    expect(DEMO_FORUM_THREADS.length).toBeGreaterThanOrEqual(8);
    expect(DEMO_FORUM_THREADS.length).toBeLessThanOrEqual(12);
    const replies = DEMO_FORUM_THREADS.reduce((sum, thread) => sum + thread.replies.length, 0);
    expect(replies).toBeGreaterThanOrEqual(20);
    expect(replies).toBeLessThanOrEqual(30);
    expect(validateDemoForumThreads(DEMO_FORUM_THREADS, AS_OF, PRESENTER)).toEqual([]);
  });

  it("gives every thread and reply a unique, deterministic id", () => {
    const threadIds = DEMO_FORUM_THREADS.map((t) => t.threadId);
    const replyIds = DEMO_FORUM_THREADS.flatMap((t) => t.replies.map((r) => r.replyId));
    expect(new Set(threadIds).size).toBe(threadIds.length);
    expect(new Set(replyIds).size).toBe(replyIds.length);
    expect(threadIds[0]).toBe("demo-thread-01");
  });

  it("never puts the presenter or a non-fixture uid on any thread or reply", () => {
    const memberUids = new Set(DEMO_MEMBER_IDENTITIES.map((i) => i.uid));
    for (const thread of DEMO_FORUM_THREADS) {
      expect(memberUids.has(thread.authorUid)).toBe(true);
      for (const reply of thread.replies) expect(memberUids.has(reply.authorUid)).toBe(true);
    }
    expect(JSON.stringify(DEMO_FORUM_THREADS)).not.toContain(PRESENTER);
  });

  it("keeps every reply after its thread and every timestamp before the as-of date", () => {
    for (const thread of DEMO_FORUM_THREADS) {
      expect(new Date(thread.createdAt).getTime()).toBeLessThanOrEqual(AS_OF.getTime());
      for (const reply of thread.replies) {
        expect(new Date(reply.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(thread.createdAt).getTime());
        expect(new Date(reply.createdAt).getTime()).toBeLessThanOrEqual(AS_OF.getTime());
      }
    }
  });
});

describe("forum fixtures: validation rejects invalid input without throwing", () => {
  const base = DEMO_FORUM_THREADS;
  const categories = (threads: DemoForumThread[]) =>
    validateDemoForumThreads(threads, AS_OF, PRESENTER).map((p) => p.category);

  it("rejects the presenter as an author", () => {
    const list = clone(base);
    list[0].authorUid = PRESENTER;
    expect(categories(list)).toContain("presenter-author");
  });

  it("rejects an author who is not a fictional member", () => {
    const list = clone(base);
    list[1].replies[0].authorUid = "someone-real";
    expect(categories(list)).toContain("author");
  });

  it("rejects a reply older than its thread", () => {
    const list = clone(base);
    list[0].replies[0].createdAt = "2026-01-01T00:00:00.000Z";
    expect(categories(list)).toContain("timestamp-order");
  });

  it("rejects a timestamp after the as-of date", () => {
    const list = clone(base);
    list[0].createdAt = "2026-12-01T00:00:00.000Z";
    expect(categories(list)).toContain("future-timestamp");
  });

  it("rejects an empty title and an over-length reply body", () => {
    const list = clone(base);
    list[0].title = "  ";
    list[0].replies[0].body = "x".repeat(2001);
    expect(categories(list)).toEqual(expect.arrayContaining(["title", "body"]));
  });

  it("rejects a repeated thread id", () => {
    const list = clone(base);
    list[1].threadId = list[0].threadId;
    expect(categories(list)).toContain("duplicate-id");
  });

  it("rejects a count outside the approved range", () => {
    expect(categories(clone(base).slice(0, 5))).toContain("count");
  });
});

describe("forum records: sealed content, AAD binding and attribution", () => {
  const thread = DEMO_FORUM_THREADS[0];
  const reply = thread.replies[0];

  it("stores no plaintext title or body in the thread or reply document", () => {
    const threadDoc = buildForumThreadDocument(thread, TEAM, demoCrypto.sealRecord);
    const replyDoc = buildForumReplyDocument(reply, thread, TEAM, demoCrypto.sealRecord);
    const serialized = JSON.stringify([threadDoc, replyDoc]);
    expect(serialized).not.toContain(thread.title);
    expect(serialized).not.toContain(thread.body);
    expect(serialized).not.toContain(reply.body);
  });

  it("opens the sealed thread only under its own team and thread id", () => {
    const doc = buildForumThreadDocument(thread, TEAM, demoCrypto.sealRecord);
    const envelope = { ciphertext: doc.ciphertext, iv: doc.iv, authTag: doc.authTag, keyVersion: doc.keyVersion, keyId: doc.keyId };
    const opened = JSON.parse(demoCrypto.openRecord(envelope, forumThreadContext(TEAM, thread.threadId)));
    expect(opened).toEqual({ title: thread.title, body: thread.body });
    expect(() => demoCrypto.openRecord(envelope, forumThreadContext("other-team", thread.threadId))).toThrow();
    expect(() => demoCrypto.openRecord(envelope, forumThreadContext(TEAM, "demo-thread-99"))).toThrow();
  });

  it("opens the sealed reply only under its own team, thread and reply id", () => {
    const doc = buildForumReplyDocument(reply, thread, TEAM, demoCrypto.sealRecord);
    const envelope = { ciphertext: doc.ciphertext, iv: doc.iv, authTag: doc.authTag, keyVersion: doc.keyVersion, keyId: doc.keyId };
    expect(demoCrypto.openRecord(envelope, forumReplyContext(TEAM, thread.threadId, reply.replyId))).toBe(reply.body);
    expect(() => demoCrypto.openRecord(envelope, forumReplyContext(TEAM, thread.threadId, "demo-reply-99-99"))).toThrow();
  });

  it("writes documents the forum's own validators accept, attributed to the fictional author", () => {
    const threadDoc = buildForumThreadDocument(thread, TEAM, demoCrypto.sealRecord);
    const replyDoc = buildForumReplyDocument(reply, thread, TEAM, demoCrypto.sealRecord);
    expect(isValidForumThread(threadDoc)).toBe(true);
    expect(threadDoc.authorUid).toBe(thread.authorUid);
    expect(isValidForumReply(replyDoc)).toBe(true);
    expect(replyDoc.authorUid).toBe(reply.authorUid);
    expect(replyDoc.threadId).toBe(thread.threadId);
  });
});

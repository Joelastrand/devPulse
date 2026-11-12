import { describe, expect, it, vi } from "vitest";
import { isErasedForumThread } from "../../forum/domain/forum-erased-thread";
import { isValidForumThread } from "../../forum/domain/forum-thread";
import { ErasureStepFailure } from "./erasure-runner";
import { runForumBatch, type ForumErasurePort, type ForumTransaction } from "./forum-erasure";
import { createFakeForumStore, type FakeForumStore } from "./forum-erasure-fake";

vi.mock("server-only", () => ({}));

const ERASED = "uid-forum-erased-1";
const OTHER = "uid-forum-other-1";
const NOW = new Date("2026-10-28T10:00:00.000Z");
const T0 = new Date("2026-10-27T09:00:00.000Z");
const T1 = new Date("2026-10-27T09:30:00.000Z");
const DEPS_TIME = () => NOW;

function thread(authorUid: string): Record<string, unknown> {
  return {
    teamId: "team-1",
    authorUid,
    ciphertext: "ct-thread",
    iv: "iv-thread",
    authTag: "tag-thread",
    keyVersion: "v2", keyId: "k1",
    createdAt: T0,
  };
}

function activeReply(threadId: string, authorUid: string, createdAt: Date = T1): Record<string, unknown> {
  return {
    teamId: "team-1",
    threadId,
    authorUid,
    ciphertext: `ct-${authorUid}`,
    iv: "iv-reply",
    authTag: "tag-reply",
    keyVersion: "v2", keyId: "k1",
    createdAt,
  };
}

function tombstone(threadId: string, deletedBy: string): Record<string, unknown> {
  return { teamId: "team-1", threadId, createdAt: T1, deletedAt: T1, deletedBy };
}

/** Runs the step to completion. Returns the number of batches it took. Fails if it never reports done. */
async function runToDone(store: FakeForumStore, maxWrites: number): Promise<number> {
  for (let batch = 1; batch <= 1000; batch += 1) {
    const result = await runForumBatch({ port: store, now: DEPS_TIME }, ERASED, maxWrites);
    if (result === "done") return batch;
  }
  throw new Error("forum step did not finish");
}

describe("forum erasure step: thread authored by the erased person (I-13)", () => {
  it("deletes the thread with its replies when no other person has an active reply", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-1", thread(ERASED));
    store.replies.set("rp-own", activeReply("th-1", ERASED));
    store.replies.set("rp-tomb-other", tombstone("th-1", OTHER));

    await runToDone(store, 100);

    expect(store.threads.has("th-1")).toBe(false);
    expect(store.replies.has("rp-own")).toBe(false);
    expect(store.replies.has("rp-tomb-other")).toBe(false);
  });

  it("replaces the thread with an erased placeholder when another person has an active reply", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-2", thread(ERASED));
    store.replies.set("rp-other", activeReply("th-2", OTHER, T1));

    await runToDone(store, 100);

    expect(store.threads.get("th-2")).toEqual({ teamId: "team-1", createdAt: T0, erasedAt: NOW, status: "erased" });
    expect(isErasedForumThread(store.threads.get("th-2"))).toBe(true);
    expect(isValidForumThread(store.threads.get("th-2"))).toBe(false);
  });

  it("keeps the other person's reply exactly as it was, so its position and author tag are unchanged", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-3", thread(ERASED));
    const otherReply = activeReply("th-3", OTHER, T1);
    store.replies.set("rp-other", otherReply);

    await runToDone(store, 100);

    expect(store.replies.get("rp-other")).toEqual(otherReply);
  });

  it("deletes the thread in chunks when the write budget is one, and never makes a placeholder", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-4", thread(ERASED));
    store.replies.set("rp-a", activeReply("th-4", ERASED));
    store.replies.set("rp-b", tombstone("th-4", OTHER));
    store.replies.set("rp-c", activeReply("th-4", ERASED));

    const batches = await runToDone(store, 1);

    expect(batches).toBeGreaterThan(3);
    expect(store.threads.has("th-4")).toBe(false);
    expect(store.replies.size).toBe(0);
  });
});

describe("forum erasure step: replies authored by the erased person (I-14)", () => {
  it("converts an active reply to the exact tombstone shape with no author or content", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-5", thread(OTHER));
    store.replies.set("rp-5", activeReply("th-5", ERASED));

    await runToDone(store, 100);

    expect(store.replies.get("rp-5")).toEqual({
      teamId: "team-1",
      threadId: "th-5",
      createdAt: T1,
      deletedAt: NOW,
      deletedBy: "erased",
    });
    const tomb = store.replies.get("rp-5") ?? {};
    for (const forbidden of ["authorUid", "ciphertext", "iv", "authTag", "keyVersion"]) {
      expect(tomb).not.toHaveProperty(forbidden);
    }
  });
});

describe("forum erasure step: A-8 other people's tombstones", () => {
  it("sets deletedBy to the erased marker only where it held the erased uid", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-6", thread(OTHER));
    store.replies.set("rp-mine", tombstone("th-6", ERASED));
    const otherTomb = tombstone("th-6", OTHER);
    store.replies.set("rp-theirs", otherTomb);

    await runToDone(store, 100);

    expect(store.replies.get("rp-mine")).toMatchObject({ deletedBy: "erased" });
    expect(store.replies.get("rp-theirs")).toEqual(otherTomb);
  });
});

describe("forum erasure step: completion and fail-closed behaviour", () => {
  it("reports done only when all three verification queries are empty", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-7", thread(OTHER));
    store.replies.set("rp-7", activeReply("th-7", ERASED));

    const first = await runForumBatch({ port: store, now: DEPS_TIME }, ERASED, 100);
    expect(first).toBe("more");
    const second = await runForumBatch({ port: store, now: DEPS_TIME }, ERASED, 100);
    expect(second).toBe("done");
    expect(await store.replyIdsAuthoredBy(ERASED, 10)).toEqual([]);
  });

  it("fails as payload_unreadable on a malformed reply in an erased thread, changing nothing", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-8", thread(ERASED));
    store.replies.set("rp-bad", { threadId: "th-8", authorUid: OTHER, ciphertext: "x" });
    const before = structuredClone([...store.threads.entries()]);

    await expect(runToDone(store, 100)).rejects.toMatchObject({ code: "payload_unreadable" });
    expect([...store.threads.entries()]).toEqual(before);
    expect(store.replies.has("rp-bad")).toBe(true);
  });

  it("fails as payload_unreadable on a malformed thread authored by the erased person instead of stalling", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-9", { authorUid: ERASED, teamId: "team-1" });

    await expect(runToDone(store, 100)).rejects.toBeInstanceOf(ErasureStepFailure);
    await expect(runToDone(store, 100)).rejects.toMatchObject({ code: "payload_unreadable" });
  });
});

describe("erased-thread placeholder predicate", () => {
  const placeholder = { teamId: "team-1", createdAt: T0, erasedAt: NOW, status: "erased" };

  it("accepts exactly the placeholder shape", () => {
    expect(isErasedForumThread(placeholder)).toBe(true);
  });

  it("rejects a placeholder that carries any extra field, such as a title or author", () => {
    expect(isErasedForumThread({ ...placeholder, title: "x" })).toBe(false);
    expect(isErasedForumThread({ ...placeholder, authorUid: ERASED })).toBe(false);
  });

  it("rejects an active thread as a placeholder", () => {
    expect(isErasedForumThread(thread(OTHER))).toBe(false);
  });
});

describe("forum erasure step: chunk boundaries and resume (TASK-014 repair)", () => {
  it("another person's reply that arrives between chunks turns the remaining deletion into a placeholder and keeps that reply", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-10", thread(ERASED));
    store.replies.set("rp-10a", activeReply("th-10", ERASED));
    store.replies.set("rp-10b", activeReply("th-10", ERASED));

    expect(await runForumBatch({ port: store, now: DEPS_TIME }, ERASED, 1)).toBe("more");
    const otherReply = activeReply("th-10", OTHER, T1);
    store.replies.set("rp-10x", otherReply);

    await runToDone(store, 1);

    expect(isErasedForumThread(store.threads.get("th-10"))).toBe(true);
    expect(store.threads.get("th-10")).toEqual({ teamId: "team-1", createdAt: T0, erasedAt: NOW, status: "erased" });
    expect(store.replies.get("rp-10x")).toEqual(otherReply);
    expect(store.replies.get("rp-10b")).toEqual({ teamId: "team-1", threadId: "th-10", createdAt: T1, deletedAt: NOW, deletedBy: "erased" });
    expect(store.replies.has("rp-10a")).toBe(false);
  });

  it("an interruption in the middle of a chunk commits nothing, and the retry finishes with the same end state", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-11", thread(ERASED));
    store.replies.set("rp-11a", activeReply("th-11", ERASED));
    store.replies.set("rp-11b", activeReply("th-11", ERASED));
    store.replies.set("rp-11c", activeReply("th-11", ERASED));

    // The chunk is one transaction: a failure after the first write must leave every reply in place.
    const interrupted: ForumErasurePort = {
      ...store,
      runTransaction: <T>(work: (tx: ForumTransaction) => Promise<T>) =>
        store.runTransaction<T>((tx) => {
          let deletes = 0;
          return work({
            ...tx,
            deleteReply(replyId) {
              deletes += 1;
              tx.deleteReply(replyId);
              if (deletes === 2) throw new Error("interrupted mid-chunk");
            },
          });
        }),
    };
    await expect(runForumBatch({ port: interrupted, now: DEPS_TIME }, ERASED, 2)).rejects.toThrow("interrupted mid-chunk");
    expect([...store.replies.keys()].sort()).toEqual(["rp-11a", "rp-11b", "rp-11c"]);
    expect(store.threads.has("th-11")).toBe(true);

    await runToDone(store, 2);

    expect(store.threads.has("th-11")).toBe(false);
    expect(store.replies.size).toBe(0);
  });
});

describe("forum erasure step: already-reached state is a no-op, not payload_unreadable (TASK-014 repair)", () => {
  it("one batch writes at most maxWrites documents across the conversion and the A-8 marker loops (BR-14 budget)", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-16", thread(OTHER));
    store.replies.set("rp-16a", activeReply("th-16", ERASED));
    store.replies.set("rp-16b", activeReply("th-16", ERASED));
    store.replies.set("rp-16c", tombstone("th-16", ERASED));
    store.replies.set("rp-16d", tombstone("th-16", ERASED));

    expect(await runForumBatch({ port: store, now: DEPS_TIME }, ERASED, 2)).toBe("more");

    expect(store.replies.get("rp-16a")).toMatchObject({ deletedBy: "erased" });
    expect(store.replies.get("rp-16b")).toMatchObject({ deletedBy: "erased" });
    expect(store.replies.get("rp-16c")).toMatchObject({ deletedBy: ERASED });
    expect(store.replies.get("rp-16d")).toMatchObject({ deletedBy: ERASED });
    await runToDone(store, 2);
    expect(store.replies.get("rp-16c")).toMatchObject({ deletedBy: "erased" });
  });

  it("a stale thread id whose author is another member is not deleted (the ownership check runs inside the transaction)", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-17", thread(OTHER));
    store.replies.set("rp-17", activeReply("th-17", OTHER));
    const stale: ForumErasurePort = { ...store, threadIdsAuthoredBy: async () => ["th-17"] };

    await expect(runForumBatch({ port: stale, now: DEPS_TIME }, ERASED, 100)).resolves.toBe("more");

    expect(store.threads.get("th-17")).toEqual(thread(OTHER));
    expect(store.replies.get("rp-17")).toEqual(activeReply("th-17", OTHER));
  });

  it("rejects a zero or non-integer write budget instead of reporting a false completion", async () => {
    const store = createFakeForumStore();
    await expect(runForumBatch({ port: store, now: DEPS_TIME }, ERASED, 0)).rejects.toThrow(RangeError);
    await expect(runForumBatch({ port: store, now: DEPS_TIME }, ERASED, 1.5)).rejects.toThrow(RangeError);
  });

  it("a stale query that returns an already-tombstoned erased-user reply does nothing and does not fail", async () => {
    const store = createFakeForumStore();
    store.threads.set("th-12", thread(OTHER));
    const tomb = tombstone("th-12", OTHER);
    store.replies.set("rp-12", tomb);
    const stale: ForumErasurePort = { ...store, replyIdsAuthoredBy: async () => ["rp-12"] };

    await expect(runForumBatch({ port: stale, now: DEPS_TIME }, ERASED, 100)).resolves.toBe("more");

    expect(store.replies.get("rp-12")).toEqual(tomb);
    expect(await runForumBatch({ port: store, now: DEPS_TIME }, ERASED, 100)).toBe("done");
  });

  it("a stale reply id that no longer exists does nothing and does not fail", async () => {
    const store = createFakeForumStore();
    const stale: ForumErasurePort = { ...store, replyIdsAuthoredBy: async () => ["rp-gone"] };

    await expect(runForumBatch({ port: stale, now: DEPS_TIME }, ERASED, 100)).resolves.toBe("more");

    expect(store.replies.size).toBe(0);
    expect(await runForumBatch({ port: store, now: DEPS_TIME }, ERASED, 100)).toBe("done");
  });

  it("a stale thread id that is already the erased placeholder does nothing and does not fail", async () => {
    const store = createFakeForumStore();
    const placeholder = { teamId: "team-1", createdAt: T0, erasedAt: T1, status: "erased" };
    store.threads.set("th-13", placeholder);
    const stale: ForumErasurePort = { ...store, threadIdsAuthoredBy: async () => ["th-13"] };

    await expect(runForumBatch({ port: stale, now: DEPS_TIME }, ERASED, 100)).resolves.toBe("more");

    expect(store.threads.get("th-13")).toEqual(placeholder);
  });

  it("a stale A-8 marker id that is missing or already not held by the erased uid does nothing", async () => {
    const store = createFakeForumStore();
    const marked = tombstone("th-14", "erased");
    store.replies.set("rp-14", marked);
    const stale: ForumErasurePort = { ...store, replyIdsDeletedBy: async () => ["rp-14", "rp-gone"] };

    await expect(runForumBatch({ port: stale, now: DEPS_TIME }, ERASED, 100)).resolves.toBe("more");

    expect(store.replies.get("rp-14")).toEqual(marked);
    expect(await runForumBatch({ port: store, now: DEPS_TIME }, ERASED, 100)).toBe("done");
  });

  it("a stale reply id that is malformed still fails closed as payload_unreadable", async () => {
    const store = createFakeForumStore();
    store.replies.set("rp-bad-stale", { threadId: "th-15", authorUid: ERASED });
    const stale: ForumErasurePort = { ...store, replyIdsAuthoredBy: async () => ["rp-bad-stale"] };

    await expect(runForumBatch({ port: stale, now: DEPS_TIME }, ERASED, 100)).rejects.toMatchObject({
      code: "payload_unreadable",
    });
  });
});

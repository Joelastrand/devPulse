import type { ForumErasurePort, ForumRaw, ForumTransaction } from "./forum-erasure";

/**
 * In-memory forum store for the erasure step tests. Transactions work on a draft and commit only when the callback
 * resolves. Queries filter the committed documents the way the verification queries do.
 */
export interface FakeForumStore extends ForumErasurePort {
  readonly threads: Map<string, Record<string, unknown>>;
  readonly replies: Map<string, Record<string, unknown>>;
}

export function createFakeForumStore(): FakeForumStore {
  const threads = new Map<string, Record<string, unknown>>();
  const replies = new Map<string, Record<string, unknown>>();

  const clone = <T>(value: T): T => structuredClone(value);

  return {
    threads,
    replies,

    async threadIdsAuthoredBy(uid, limit) {
      return [...threads]
        .filter(([, data]) => data.authorUid === uid)
        .slice(0, limit)
        .map(([id]) => id);
    },

    async replyIdsAuthoredBy(uid, limit) {
      return [...replies]
        .filter(([, data]) => data.authorUid === uid)
        .slice(0, limit)
        .map(([id]) => id);
    },

    async replyIdsDeletedBy(uid, limit) {
      return [...replies]
        .filter(([, data]) => data.deletedBy === uid)
        .slice(0, limit)
        .map(([id]) => id);
    },

    async runTransaction(work) {
      const draftThreads = new Map([...threads].map(([id, data]) => [id, clone(data)] as const));
      const draftReplies = new Map([...replies].map(([id, data]) => [id, clone(data)] as const));

      const tx: ForumTransaction = {
        async getThread(threadId) {
          const data = draftThreads.get(threadId);
          return data === undefined ? undefined : clone(data);
        },
        async getThreadReplies(threadId) {
          const found: ForumRaw[] = [];
          for (const [id, data] of draftReplies) {
            if (data.threadId === threadId) found.push({ id, data: clone(data) });
          }
          return found;
        },
        setThread(threadId, data) {
          draftThreads.set(threadId, clone(data));
        },
        deleteThread(threadId) {
          draftThreads.delete(threadId);
        },
        async getReply(replyId) {
          const data = draftReplies.get(replyId);
          return data === undefined ? undefined : clone(data);
        },
        setReply(replyId, data) {
          draftReplies.set(replyId, clone(data));
        },
        deleteReply(replyId) {
          draftReplies.delete(replyId);
        },
      };

      const result = await work(tx);
      threads.clear();
      for (const [id, data] of draftThreads) threads.set(id, data);
      replies.clear();
      for (const [id, data] of draftReplies) replies.set(id, data);
      return result;
    },
  };
}

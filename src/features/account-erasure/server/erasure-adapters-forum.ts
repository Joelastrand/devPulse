import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { ForumErasurePort, ForumRaw, ForumTransaction } from "./forum-erasure";

/**
 * Production Admin SDK adapter for the `forum` erasure step (TASK-038; SPEC BR-7, I-13, I-14, A-8). Forum erasure never
 * decrypts. Writes are full replacements of the record the step computed, inside the step's own transactions. Thread replies
 * are read with a transactional query (`threadId ==`), as the step requires for its invariant check.
 */

const THREADS = "forumThreads";
const REPLIES = "forumReplies";

function assertUidSegment(uid: string): void {
  if (uid.length === 0 || uid.includes("/")) throw new Error("erasure adapter: invalid uid segment");
}

export function createForumPort(): ForumErasurePort {
  return {
    async runTransaction<T>(work: (tx: ForumTransaction) => Promise<T>): Promise<T> {
      const db = getFirestoreDb();
      return db.runTransaction((tx) =>
        work({
          async getThread(threadId) {
            const snapshot = await tx.get(db.collection(THREADS).doc(threadId));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          async getThreadReplies(threadId): Promise<ForumRaw[]> {
            const snapshot = await tx.get(db.collection(REPLIES).where("threadId", "==", threadId));
            return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
          },
          setThread(threadId, data) {
            tx.set(db.collection(THREADS).doc(threadId), data);
          },
          deleteThread(threadId) {
            tx.delete(db.collection(THREADS).doc(threadId));
          },
          async getReply(replyId) {
            const snapshot = await tx.get(db.collection(REPLIES).doc(replyId));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          setReply(replyId, data) {
            tx.set(db.collection(REPLIES).doc(replyId), data);
          },
          deleteReply(replyId) {
            tx.delete(db.collection(REPLIES).doc(replyId));
          },
        }),
      );
    },
    async threadIdsAuthoredBy(uid, limit) {
      assertUidSegment(uid);
      const snapshot = await getFirestoreDb().collection(THREADS).where("authorUid", "==", uid).select().limit(limit).get();
      return snapshot.docs.map((doc) => doc.id);
    },
    async replyIdsAuthoredBy(uid, limit) {
      assertUidSegment(uid);
      const snapshot = await getFirestoreDb().collection(REPLIES).where("authorUid", "==", uid).select().limit(limit).get();
      return snapshot.docs.map((doc) => doc.id);
    },
    async replyIdsDeletedBy(uid, limit) {
      assertUidSegment(uid);
      const snapshot = await getFirestoreDb().collection(REPLIES).where("deletedBy", "==", uid).select().limit(limit).get();
      return snapshot.docs.map((doc) => doc.id);
    },
  };
}

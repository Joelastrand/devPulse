import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdminFirestore } from "./admin-firestore.test-helper";
import { createForumPort } from "./erasure-adapters-forum";
import { createForumStepHandler } from "./forum-erasure";

// TASK-038: the forum step over the production adapter, against the Admin Firestore recording double (structural).

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({ getFirestoreDb: () => holder.db }));
vi.mock("server-only", () => ({}));

const UID = "uid-38f";
const OTHER = "uid-other";
const TEAM = "team-38f";
let db: FakeAdminFirestore;
const CREATED = new Date("2026-10-01T00:00:00Z");
/** A valid encrypted thread record (synthetic values; the forum step never decrypts). */
function threadRecord(authorUid: string, extra: Record<string, unknown> = {}) {
  return { teamId: TEAM, authorUid, ciphertext: "c-ct", iv: "c-iv", authTag: "c-tag", keyVersion: "v2", keyId: "k1", createdAt: CREATED, ...extra };
}
/** A valid encrypted active reply record. */
function replyRecord(threadId: string, authorUid: string, extra: Record<string, unknown> = {}) {
  return { teamId: TEAM, threadId, authorUid, ciphertext: "r-ct", iv: "r-iv", authTag: "r-tag", keyVersion: "v2", keyId: "k1", createdAt: CREATED, ...extra };
}

beforeEach(() => {
  db = new FakeAdminFirestore();
  holder.db = db;
});

async function runToDone(uid: string): Promise<void> {
  const handler = createForumStepHandler({ port: createForumPort(), now: () => new Date("2026-11-02T00:00:00Z") });
  for (let i = 0; i < 50; i += 1) {
    if ((await handler.runBatch({ uid, maxWrites: 100 })) === "done") return;
  }
  throw new Error("forum step did not complete");
}

describe("forum step over the production adapter", () => {
  it("deletes a thread that only the erased person wrote, with its replies", async () => {
    db.docs.set(`forumThreads/t1`, threadRecord(UID));
    db.docs.set(`forumReplies/r1`, replyRecord("t1", UID));

    await runToDone(UID);

    expect(db.docs.has("forumThreads/t1")).toBe(false);
    expect(db.docs.has("forumReplies/r1")).toBe(false);
  });

  it("keeps a thread as an erased placeholder when another person replied, and keeps that reply untouched", async () => {
    db.docs.set(`forumThreads/t2`, threadRecord(UID));
    db.docs.set(`forumReplies/own`, replyRecord("t2", UID));
    db.docs.set(`forumReplies/others`, replyRecord("t2", OTHER, { authorTag: "tag" }));

    await runToDone(UID);

    const thread = db.docs.get("forumThreads/t2") as Record<string, unknown>;
    expect(thread).toMatchObject({ teamId: TEAM, status: "erased" });
    expect(thread).not.toHaveProperty("title");
    expect(thread).not.toHaveProperty("authorUid");
    expect(db.docs.get("forumReplies/others")).toMatchObject({ authorUid: OTHER, ciphertext: "r-ct", authorTag: "tag" });
    // The erased person's own reply becomes a tombstone (I-14): no author, no content, deletedBy the marker.
    const tombstone = db.docs.get("forumReplies/own") as Record<string, unknown>;
    expect(tombstone).toMatchObject({ teamId: TEAM, threadId: "t2", deletedBy: "erased" });
    expect(tombstone).not.toHaveProperty("authorUid");
    expect(tombstone).not.toHaveProperty("ciphertext");
  });

  it("reads thread replies with a transactional query", async () => {
    db.docs.set(`forumThreads/t3`, threadRecord(UID));
    db.docs.set(`forumReplies/r3`, replyRecord("t3", OTHER));

    await runToDone(UID);

    expect(db.transactionalReads).toContain("forumReplies");
  });
});

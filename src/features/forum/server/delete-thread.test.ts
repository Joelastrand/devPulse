import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as encryptionModule from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { createThread } from "./create-thread";
import type { ForumThreadsCollection } from "./create-thread";
import * as deleteThreadModule from "./delete-thread";
import type {
  DeleteThreadDeps,
  DeleteThreadDocSnapshot,
  ForumThreadDocStore,
  RepliesCascadeStore,
} from "./delete-thread";
import { DELETE_THREAD_CASCADE_BATCH_SIZE, deleteThread } from "./delete-thread";
import { listTeamThreads } from "./list-team-threads";
import type { ThreadsReader } from "./list-team-threads";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const THREAD_ID = "thread-1";
const AUTHOR_UID = "author-1";
const OTHER_MEMBER_UID = "member-2";
const ADMIN_UID = "admin-1";
const ADMIN_EMAIL = "admin@example.com";

function memberIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: AUTHOR_UID, email: "author@example.com", emailVerified: true, ...overrides };
}

function adminIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: ADMIN_UID, email: ADMIN_EMAIL, emailVerified: true, ...overrides };
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function threadRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    authorUid: AUTHOR_UID,
    ciphertext: "ciphertext-bytes",
    iv: "iv-bytes",
    authTag: "auth-tag-bytes",
    keyVersion: "v1",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

function fakeThreadDocStore(
  data: unknown,
): ForumThreadDocStore & { deletedIds: string[]; getCalls: string[] } {
  const deletedIds: string[] = [];
  const getCalls: string[] = [];
  let current = data;
  return {
    deletedIds,
    getCalls,
    async get(threadId) {
      getCalls.push(threadId);
      const snapshot: DeleteThreadDocSnapshot = {
        exists: current !== undefined,
        data: () => current,
      };
      return snapshot;
    },
    async delete(threadId) {
      deletedIds.push(threadId);
      current = undefined;
    },
  };
}

function failingThreadDocStore(): ForumThreadDocStore {
  return {
    get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    delete: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
  };
}

function fakeRepliesCascadeStore(
  replyCount: number,
  batchSize = DELETE_THREAD_CASCADE_BATCH_SIZE,
): RepliesCascadeStore & { calls: number; batchesDeleted: number[] } {
  let remaining = replyCount;
  const batchesDeleted: number[] = [];
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    batchesDeleted,
    async deleteNextBatch() {
      calls += 1;
      const toDelete = Math.min(remaining, batchSize);
      remaining -= toDelete;
      batchesDeleted.push(toDelete);
      return toDelete;
    },
  };
}

function failingRepliesCascadeStore(): RepliesCascadeStore {
  return {
    deleteNextBatch: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
  };
}

function baseDeps(overrides: Partial<DeleteThreadDeps> = {}): DeleteThreadDeps {
  return {
    verifyToken: verifyTokenReturning(memberIdentity()),
    allowList: [ADMIN_EMAIL],
    threadDocs: fakeThreadDocStore(threadRecord()),
    repliesCascade: fakeRepliesCascadeStore(0),
    ...overrides,
  };
}

describe("deleteThread", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("lets the thread's own author permanently delete it", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord());
    const result = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));

    expect(result).toEqual({ ok: true });
    expect(threadDocs.deletedIds).toEqual([THREAD_ID]);
  });

  it("lets an app admin delete someone else's thread", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord({ authorUid: OTHER_MEMBER_UID }));
    const result = await deleteThread(
      "token",
      TEAM_ID,
      THREAD_ID,
      baseDeps({ verifyToken: verifyTokenReturning(adminIdentity()), threadDocs }),
    );

    expect(result).toEqual({ ok: true });
    expect(threadDocs.deletedIds).toEqual([THREAD_ID]);
  });

  it("rejects an unauthenticated caller and performs no reads or writes", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord());
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await deleteThread("bad-token", TEAM_ID, THREAD_ID, baseDeps({ verifyToken, threadDocs }));

    expect(result).toEqual({ ok: false, error: "sign_in_required" });
    expect(threadDocs.getCalls).toHaveLength(0);
  });

  it("rejects a plain member who is neither the author nor an app admin, with zero writes", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord());
    const result = await deleteThread(
      "token",
      TEAM_ID,
      THREAD_ID,
      baseDeps({ verifyToken: verifyTokenReturning(memberIdentity({ uid: OTHER_MEMBER_UID, email: "other@example.com" })), threadDocs }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(threadDocs.deletedIds).toHaveLength(0);
  });

  it("rejects a threadId belonging to another team with not_found, and writes nothing", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord({ teamId: OTHER_TEAM_ID }));
    const result = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(threadDocs.deletedIds).toHaveLength(0);
  });

  it("rejects a never-existed threadId with not_found", async () => {
    const threadDocs = fakeThreadDocStore(undefined);
    const result = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("rejects a malformed thread document with not_found, and writes nothing", async () => {
    const threadDocs = fakeThreadDocStore({ teamId: TEAM_ID }); // missing required fields
    const result = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(threadDocs.deletedIds).toHaveLength(0);
  });

  it("returns not_found (not idempotent {ok:true}) on a second call against an already-deleted thread", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord());
    const first = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));
    const second = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, error: "not_found" });
    expect(threadDocs.deletedIds).toEqual([THREAD_ID]);
  });

  it("the thread document is actually absent from Firestore afterward, not merely excluded from a DTO", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord());
    await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));

    const snapshot = await threadDocs.get(THREAD_ID);
    expect(snapshot.exists).toBe(false);
  });

  it("cascades to delete every one of the thread's replies", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord());
    const repliesCascade = fakeRepliesCascadeStore(120);

    const result = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs, repliesCascade }));

    expect(result).toEqual({ ok: true });
    expect(repliesCascade.batchesDeleted.reduce((a, b) => a + b, 0)).toBe(120);
  });

  it("removes more than 500 replies across multiple batches, not just the first batch (BR-54)", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord());
    const repliesCascade = fakeRepliesCascadeStore(1_250, 500);

    const result = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs, repliesCascade }));

    expect(result).toEqual({ ok: true });
    // 500 + 500 + 250, then a final zero-result call signaling completion.
    expect(repliesCascade.batchesDeleted).toEqual([500, 500, 250, 0]);
    expect(repliesCascade.calls).toBe(4);
  });

  it("deletes the thread document before touching any reply (BR-55 ordering)", async () => {
    const order: string[] = [];
    const threadDocs: ForumThreadDocStore = {
      async get() {
        return { exists: true, data: () => threadRecord() };
      },
      async delete() {
        order.push("thread-deleted");
      },
    };
    const repliesCascade: RepliesCascadeStore = {
      async deleteNextBatch() {
        order.push("reply-batch-deleted");
        return 0;
      },
    };

    await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs, repliesCascade }));

    expect(order).toEqual(["thread-deleted", "reply-batch-deleted"]);
  });

  it("an ex-member (real membership already removed) can still delete their own thread — the author-ownership path never consults membership", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord());
    // No membership-related dependency exists on this operation's signature
    // at all — proven structurally: deleteThread succeeds using only
    // verifyToken/threadDocs/repliesCascade/allowList, with no membership
    // seam to stub or fail.
    const result = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));

    expect(result).toEqual({ ok: true });
  });

  it("succeeds against a disabled team's content with zero teams reads (no team-status dependency exists on this operation)", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord());
    const result = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));

    expect(result).toEqual({ ok: true });
    // Structural proof: DeleteThreadDeps has no team-status-reader field to
    // stub in the first place, so a disabled team cannot block this call.
  });

  it("fails closed (persistence_failed) when the thread read throws", async () => {
    const result = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs: failingThreadDocStore() }));
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("fails closed (persistence_failed) when the thread delete itself throws", async () => {
    const threadDocs: ForumThreadDocStore = {
      async get() {
        return { exists: true, data: () => threadRecord() };
      },
      delete: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("fails closed (persistence_failed) when the reply cascade throws, after the thread is already deleted", async () => {
    const threadDocs = fakeThreadDocStore(threadRecord());
    const result = await deleteThread(
      "token",
      TEAM_ID,
      THREAD_ID,
      baseDeps({ threadDocs, repliesCascade: failingRepliesCascadeStore() }),
    );

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    // The thread itself was already deleted before the cascade failed
    // (SPEC "Edge cases and concurrency" — a crash here leaves the thread
    // gone and possibly some orphaned replies; this is a documented,
    // accepted residual, not a bug this operation papers over).
    expect(threadDocs.deletedIds).toEqual([THREAD_ID]);
  });

  it("never calls decrypt on any path", async () => {
    const decryptSpy = vi.spyOn(encryptionModule, "decrypt");
    const threadDocs = fakeThreadDocStore(threadRecord());
    await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs }));

    expect(decryptSpy).not.toHaveBeenCalled();
  });

  it("never logs on any success, rejection, or failure path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs: fakeThreadDocStore(threadRecord()) }));
    await deleteThread(
      "token",
      TEAM_ID,
      THREAD_ID,
      baseDeps({ verifyToken: verifyTokenReturning(memberIdentity({ uid: OTHER_MEMBER_UID })), threadDocs: fakeThreadDocStore(threadRecord()) }),
    );
    await deleteThread("token", TEAM_ID, THREAD_ID, baseDeps({ threadDocs: failingThreadDocStore() }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("exposes no restore/undelete-shaped export from this module", () => {
    expect(Object.keys(deleteThreadModule).sort()).toEqual(
      ["DELETE_THREAD_CASCADE_BATCH_SIZE", "deleteThread"].sort(),
    );
  });

  // Carried over from TASK-002's own deferred acceptance criterion: the
  // composed regression create -> delete -> re-list, using the real
  // createThread/deleteThread/listTeamThreads operations together, backed by
  // one shared in-memory store standing in for Firestore across all three.
  describe("composed regression with the real createThread and listTeamThreads (TASK-002 carry-over)", () => {
    function createInMemoryThreadsStore(): ForumThreadDocStore &
      ForumThreadsCollection &
      ThreadsReader & { size(): number } {
      const docs = new Map<string, Record<string, unknown>>();
      let counter = 0;
      return {
        async add(record) {
          counter += 1;
          const id = `thread-${counter}`;
          docs.set(id, { ...record });
          return { id };
        },
        async listRecentForTeam(teamId) {
          return [...docs.entries()]
            .filter(([, data]) => data.teamId === teamId)
            .sort((a, b) => (b[1].createdAt as Date).getTime() - (a[1].createdAt as Date).getTime())
            .map(([id, data]) => ({ id, data }));
        },
        async get(threadId) {
          const data = docs.get(threadId);
          return { exists: data !== undefined, data: () => data };
        },
        async delete(threadId) {
          docs.delete(threadId);
        },
        size() {
          return docs.size;
        },
      };
    }

    function fakeAuthCollection(): AuthorizeTeamAccessCollection {
      return {
        async getTeamStatus() {
          return "active";
        },
        async getMembership(uid, teamId) {
          return uid === AUTHOR_UID && teamId === TEAM_ID ? { uid, teamId } : undefined;
        },
      };
    }

    it("a thread created via the real createThread and deleted via the real deleteThread never appears in a subsequent real listTeamThreads call", async () => {
      const store = createInMemoryThreadsStore();

      const created = await createThread("token", TEAM_ID, "A real thread title", "A real thread body", {
        verifyToken: verifyTokenReturning(memberIdentity()),
        membershipReader: { async getMembership(uid, teamId) {
          return uid === AUTHOR_UID && teamId === TEAM_ID ? { uid, teamId } : undefined;
        } },
        teamStatusReader: { async getTeamStatus() { return "active"; } },
        collection: store,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("expected creation to succeed");

      const beforeDelete = await listTeamThreads("token", TEAM_ID, {
        verifyToken: verifyTokenReturning(memberIdentity()),
        allowList: [ADMIN_EMAIL],
        authCollection: fakeAuthCollection(),
        reader: store,
      });
      expect(beforeDelete.ok).toBe(true);
      if (!beforeDelete.ok) throw new Error("expected list to succeed");
      expect(beforeDelete.threads.map((t) => t.threadId)).toContain(created.threadId);

      const deleted = await deleteThread("token", TEAM_ID, created.threadId, {
        verifyToken: verifyTokenReturning(memberIdentity()),
        allowList: [ADMIN_EMAIL],
        threadDocs: store,
        repliesCascade: { async deleteNextBatch() { return 0; } },
      });
      expect(deleted).toEqual({ ok: true });
      expect(store.size()).toBe(0);

      const afterDelete = await listTeamThreads("token", TEAM_ID, {
        verifyToken: verifyTokenReturning(memberIdentity()),
        allowList: [ADMIN_EMAIL],
        authCollection: fakeAuthCollection(),
        reader: store,
      });
      expect(afterDelete.ok).toBe(true);
      if (!afterDelete.ok) throw new Error("expected list to succeed");
      expect(afterDelete.threads.map((t) => t.threadId)).not.toContain(created.threadId);
      expect(afterDelete.threads).toEqual([]);
    });
  });
});

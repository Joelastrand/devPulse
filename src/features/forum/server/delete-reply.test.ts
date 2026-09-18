import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EncryptedPayload } from "../../../lib/encryption/encryption";
import { decrypt, encrypt } from "../../../lib/encryption/encryption";
import * as encryptionModule from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { createReply } from "./create-reply";
import type { ActiveForumReply } from "../domain/forum-reply";
import * as deleteReplyModule from "./delete-reply";
import type { DeleteReplyDeps, DeleteReplyDocSnapshot, ForumReplyDocStore } from "./delete-reply";
import { deleteReply } from "./delete-reply";
import { getThreadWithReplies } from "./get-thread-with-replies";
import type { ForumRepliesReader, ForumThreadReader, RawReplyDoc } from "./get-thread-with-replies";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const THREAD_ID = "thread-1";
const OTHER_THREAD_ID = "thread-2";
const REPLY_ID = "reply-1";
const AUTHOR_UID = "author-1";
const OTHER_MEMBER_UID = "member-2";
const ADMIN_UID = "admin-1";
const ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-09-01T00:00:00Z");

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

function activeReplyRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    threadId: THREAD_ID,
    authorUid: AUTHOR_UID,
    ciphertext: "ciphertext-bytes",
    iv: "iv-bytes",
    authTag: "auth-tag-bytes",
    keyVersion: "v1",
    createdAt: new Date("2026-08-02T00:00:00Z"),
    ...overrides,
  };
}

function tombstoneReplyRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    threadId: THREAD_ID,
    createdAt: new Date("2026-08-02T00:00:00Z"),
    deletedAt: new Date("2026-08-03T00:00:00Z"),
    deletedBy: ADMIN_UID,
    ...overrides,
  };
}

function fakeForumReplyDocStore(
  data: unknown,
): ForumReplyDocStore & { doc: Record<string, unknown> | undefined; tombstoneCalls: number } {
  let current = data as Record<string, unknown> | undefined;
  let tombstoneCalls = 0;
  return {
    get doc() {
      return current;
    },
    get tombstoneCalls() {
      return tombstoneCalls;
    },
    async get() {
      const snapshot: DeleteReplyDocSnapshot = {
        exists: current !== undefined,
        data: () => current,
      };
      return snapshot;
    },
    async tombstone(_replyId, deletedAt, deletedBy) {
      tombstoneCalls += 1;
      current = {
        teamId: current?.teamId,
        threadId: current?.threadId,
        createdAt: current?.createdAt,
        deletedAt,
        deletedBy,
      };
    },
  };
}

function failingForumReplyDocStore(): ForumReplyDocStore {
  return {
    get: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    tombstone: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
  };
}

function baseDeps(overrides: Partial<DeleteReplyDeps> = {}): DeleteReplyDeps {
  return {
    verifyToken: verifyTokenReturning(memberIdentity()),
    allowList: [ADMIN_EMAIL],
    docs: fakeForumReplyDocStore(activeReplyRecord()),
    now: NOW,
    ...overrides,
  };
}

describe("deleteReply", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("lets the reply's own author delete it", async () => {
    const docs = fakeForumReplyDocStore(activeReplyRecord());
    const result = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
    expect(docs.tombstoneCalls).toBe(1);
  });

  it("lets an app admin delete someone else's reply", async () => {
    const docs = fakeForumReplyDocStore(activeReplyRecord({ authorUid: OTHER_MEMBER_UID }));
    const result = await deleteReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      REPLY_ID,
      baseDeps({ verifyToken: verifyTokenReturning(adminIdentity()), docs }),
    );

    expect(result).toEqual({ ok: true });
    expect(docs.tombstoneCalls).toBe(1);
  });

  it("rejects an unauthenticated caller and performs no reads or writes", async () => {
    const docs = fakeForumReplyDocStore(activeReplyRecord());
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await deleteReply("bad-token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ verifyToken, docs }));

    expect(result).toEqual({ ok: false, error: "sign_in_required" });
    expect(docs.tombstoneCalls).toBe(0);
  });

  it("rejects a plain member who is neither the author nor an app admin, with zero writes", async () => {
    const docs = fakeForumReplyDocStore(activeReplyRecord());
    const result = await deleteReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      REPLY_ID,
      baseDeps({
        verifyToken: verifyTokenReturning(memberIdentity({ uid: OTHER_MEMBER_UID, email: "other@example.com" })),
        docs,
      }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(docs.tombstoneCalls).toBe(0);
  });

  it("rejects a replyId belonging to another team with not_found, and writes nothing", async () => {
    const docs = fakeForumReplyDocStore(activeReplyRecord({ teamId: OTHER_TEAM_ID }));
    const result = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(docs.tombstoneCalls).toBe(0);
  });

  it("rejects a replyId belonging to another thread (same team) with not_found, and writes nothing", async () => {
    const docs = fakeForumReplyDocStore(activeReplyRecord({ threadId: OTHER_THREAD_ID }));
    const result = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(docs.tombstoneCalls).toBe(0);
  });

  it("rejects a never-existed replyId with not_found", async () => {
    const docs = fakeForumReplyDocStore(undefined);
    const result = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("rejects a malformed reply document with not_found, and writes nothing", async () => {
    const docs = fakeForumReplyDocStore({ teamId: TEAM_ID, threadId: THREAD_ID }); // missing required fields
    const result = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(docs.tombstoneCalls).toBe(0);
  });

  describe("idempotency (BR-27) — any authenticated caller may retry an already-tombstoned reply", () => {
    it("is idempotent when the same author calls again while still recognizable — repeat call by an app admin observing the tombstone succeeds as a no-op", async () => {
      const docs = fakeForumReplyDocStore(activeReplyRecord());
      const first = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));
      expect(first).toEqual({ ok: true });
      expect(docs.tombstoneCalls).toBe(1);

      // Mirrors SPEC's documented edge case: the author's call tombstones
      // the reply; an app admin's later call on the same reply observes the
      // tombstone already present and returns the identical idempotent
      // success, with no second write.
      const second = await deleteReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        REPLY_ID,
        baseDeps({ verifyToken: verifyTokenReturning(adminIdentity()), docs }),
      );

      expect(second).toEqual({ ok: true });
      expect(docs.tombstoneCalls).toBe(1);
    });

    it("an app admin calling deleteReply twice on the same reply is idempotent with no second write", async () => {
      const docs = fakeForumReplyDocStore(activeReplyRecord());
      const adminDeps = baseDeps({ verifyToken: verifyTokenReturning(adminIdentity()), docs });

      const first = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, adminDeps);
      const second = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, adminDeps);

      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: true });
      expect(docs.tombstoneCalls).toBe(1);
    });

    it("the same original author retrying their own already-tombstoned reply gets idempotent success, with zero additional writes (BR-27, revised — a retried/lost response must not be met with a spurious forbidden)", async () => {
      const docs = fakeForumReplyDocStore(activeReplyRecord());
      const first = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));
      expect(first).toEqual({ ok: true });
      expect(docs.tombstoneCalls).toBe(1);

      const retry = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));

      expect(retry).toEqual({ ok: true });
      expect(docs.tombstoneCalls).toBe(1);
    });

    it("a different authenticated non-admin, non-author caller retrying an already-tombstoned reply also gets idempotent success, with zero writes — there is no authorUid left to re-authorize against, and none is reconstructed to perform one", async () => {
      const docs = fakeForumReplyDocStore(tombstoneReplyRecord());
      const result = await deleteReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        REPLY_ID,
        baseDeps({ verifyToken: verifyTokenReturning(memberIdentity({ uid: OTHER_MEMBER_UID, email: "other@example.com" })), docs }),
      );

      expect(result).toEqual({ ok: true });
      expect(docs.tombstoneCalls).toBe(0);
    });

    it("the reply's original (now-former) author retrying their own already-tombstoned reply also gets idempotent success", async () => {
      const docs = fakeForumReplyDocStore(tombstoneReplyRecord());
      const result = await deleteReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        REPLY_ID,
        baseDeps({ verifyToken: verifyTokenReturning(memberIdentity()), docs }),
      );

      expect(result).toEqual({ ok: true });
      expect(docs.tombstoneCalls).toBe(0);
    });

    it("an app admin retrying an already-tombstoned reply gets idempotent success, with zero writes", async () => {
      const docs = fakeForumReplyDocStore(tombstoneReplyRecord());
      const result = await deleteReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        REPLY_ID,
        baseDeps({ verifyToken: verifyTokenReturning(adminIdentity()), docs }),
      );

      expect(result).toEqual({ ok: true });
      expect(docs.tombstoneCalls).toBe(0);
    });

    it("a wrong-team tombstoned reply still resolves to not_found, never an idempotent success — the tombstone shortcut is never reached before the teamId cross-check, so it cannot become an existence oracle", async () => {
      const docs = fakeForumReplyDocStore(tombstoneReplyRecord({ teamId: OTHER_TEAM_ID }));
      const result = await deleteReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        REPLY_ID,
        baseDeps({ verifyToken: verifyTokenReturning(memberIdentity({ uid: OTHER_MEMBER_UID, email: "other@example.com" })), docs }),
      );

      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(docs.tombstoneCalls).toBe(0);
    });

    it("a wrong-thread tombstoned reply (same team) still resolves to not_found, never an idempotent success", async () => {
      const docs = fakeForumReplyDocStore(tombstoneReplyRecord({ threadId: OTHER_THREAD_ID }));
      const result = await deleteReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        REPLY_ID,
        baseDeps({ verifyToken: verifyTokenReturning(memberIdentity({ uid: OTHER_MEMBER_UID, email: "other@example.com" })), docs }),
      );

      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(docs.tombstoneCalls).toBe(0);
    });

    it("an unauthenticated caller retrying an already-tombstoned reply is still rejected before any tombstone state is even read", async () => {
      const docs = fakeForumReplyDocStore(tombstoneReplyRecord());
      const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

      const result = await deleteReply("bad-token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ verifyToken, docs }));

      expect(result).toEqual({ ok: false, error: "sign_in_required" });
      expect(docs.tombstoneCalls).toBe(0);
    });
  });

  it("the persisted document after deletion contains exactly {teamId, threadId, createdAt, deletedAt, deletedBy} — verified via Object.keys", async () => {
    const docs = fakeForumReplyDocStore(activeReplyRecord());
    await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs, now: NOW }));

    expect(Object.keys(docs.doc ?? {}).sort()).toEqual(
      ["createdAt", "deletedAt", "deletedBy", "teamId", "threadId"].sort(),
    );
    expect(docs.doc?.deletedAt).toEqual(NOW);
    expect(docs.doc?.deletedBy).toBe(AUTHOR_UID);
    for (const forbiddenKey of ["ciphertext", "iv", "authTag", "keyVersion", "authorUid"]) {
      expect(docs.doc).not.toHaveProperty(forbiddenKey);
    }
  });

  it("deletedBy always equals the verified caller's own uid, never a client-supplied value (no such field exists on this function's signature)", async () => {
    const docs = fakeForumReplyDocStore(activeReplyRecord({ authorUid: OTHER_MEMBER_UID }));
    await deleteReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      REPLY_ID,
      baseDeps({ verifyToken: verifyTokenReturning(adminIdentity()), docs }),
    );

    expect(docs.doc?.deletedBy).toBe(ADMIN_UID);
  });

  it("leaves the thread and its other replies unaffected — a cross-check via the real getThreadWithReplies before/after", async () => {
    const otherActiveReply: RawReplyDoc = {
      id: "reply-other",
      data: {
        teamId: TEAM_ID,
        threadId: THREAD_ID,
        authorUid: OTHER_MEMBER_UID,
        createdAt: new Date("2026-08-02T12:00:00Z"),
        ...encrypt("Untouched reply"),
      },
    };
    const targetReply = fakeForumReplyDocStore(activeReplyRecord());

    const repliesReader: ForumRepliesReader = {
      async listOrderedForThread() {
        return [
          { id: REPLY_ID, data: targetReply.doc },
          otherActiveReply,
        ];
      },
    };
    const threadReader: ForumThreadReader = {
      async getThread() {
        return {
          teamId: TEAM_ID,
          authorUid: AUTHOR_UID,
          createdAt: new Date("2026-08-01T00:00:00Z"),
          ...encrypt(JSON.stringify({ title: "T", body: "B" })),
        };
      },
    };
    const authCollection: AuthorizeTeamAccessCollection = {
      async getTeamStatus() {
        return "active";
      },
      async getMembership(uid, teamId) {
        return uid === AUTHOR_UID && teamId === TEAM_ID ? { uid, teamId } : undefined;
      },
    };

    await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs: targetReply }));

    const detail = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, {
      verifyToken: verifyTokenReturning(memberIdentity()),
      allowList: [ADMIN_EMAIL],
      authCollection,
      threadReader,
      repliesReader,
    });

    expect(detail.ok).toBe(true);
    if (!detail.ok) throw new Error("expected ok result");
    expect(detail.thread.title).toBe("T");
    const untouched = detail.replies.find((r) => r.replyId === "reply-other");
    expect(untouched).toMatchObject({ isDeleted: false, body: "Untouched reply" });
  });

  it("the two-actor concurrent-delete scenario: both calls succeed and deletedBy reflects whichever write lands last", async () => {
    // Mirrors `challenge-management-concurrency.test.ts`'s established
    // fake: `get()` always returns the original, never-mutated snapshot (as
    // if both calls' reads happened before either call's write landed),
    // modeling the real non-transactional race (docs/features/team-forum/
    // SPEC.md — "Edge cases and concurrency") rather than relying on
    // incidental microtask-scheduling order.
    const initial = activeReplyRecord();
    const writes: { deletedAt: Date; deletedBy: string }[] = [];
    const docs: ForumReplyDocStore = {
      async get() {
        return { exists: true, data: () => initial };
      },
      async tombstone(_replyId, deletedAt, deletedBy) {
        writes.push({ deletedAt, deletedBy });
      },
    };

    const [authorResult, adminResult] = await Promise.all([
      deleteReply("token-1", TEAM_ID, THREAD_ID, REPLY_ID, {
        verifyToken: verifyTokenReturning(memberIdentity()),
        allowList: [ADMIN_EMAIL],
        docs,
        now: new Date("2026-09-01T00:00:00Z"),
      }),
      deleteReply("token-2", TEAM_ID, THREAD_ID, REPLY_ID, {
        verifyToken: verifyTokenReturning(adminIdentity()),
        allowList: [ADMIN_EMAIL],
        docs,
        now: new Date("2026-09-01T00:00:05Z"),
      }),
    ]);

    expect(authorResult).toEqual({ ok: true });
    expect(adminResult).toEqual({ ok: true });
    // Both calls proceeded to write (neither observed the other's tombstone
    // before deciding, since this fake models a true concurrent read) — the
    // final `deletedBy` is whichever write physically lands last, an
    // accepted imprecision never exposed by any API response (BR-28).
    expect(writes).toHaveLength(2);
    const lastWrite = writes[writes.length - 1];
    expect(lastWrite.deletedBy).toEqual(expect.any(String));
    expect([AUTHOR_UID, ADMIN_UID]).toContain(lastWrite.deletedBy);
  });

  it("succeeds against a disabled team's content with zero teams reads (no team-status dependency exists on this operation)", async () => {
    const docs = fakeForumReplyDocStore(activeReplyRecord());
    const result = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));

    expect(result).toEqual({ ok: true });
  });

  it("fails closed (persistence_failed) when the reply read throws", async () => {
    const result = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs: failingForumReplyDocStore() }));
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("fails closed (persistence_failed) when the tombstone write itself throws", async () => {
    const docs: ForumReplyDocStore = {
      async get() {
        return { exists: true, data: () => activeReplyRecord() };
      },
      tombstone: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("never calls decrypt on any path", async () => {
    const decryptSpy = vi.spyOn(encryptionModule, "decrypt");
    const docs = fakeForumReplyDocStore(activeReplyRecord());
    await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs }));

    expect(decryptSpy).not.toHaveBeenCalled();
  });

  it("never calls decrypt on the idempotent tombstone-retry path either — a different non-admin caller retrying an already-tombstoned reply never decrypts anything (there is nothing left to decrypt)", async () => {
    const decryptSpy = vi.spyOn(encryptionModule, "decrypt");
    const docs = fakeForumReplyDocStore(tombstoneReplyRecord());
    const result = await deleteReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      REPLY_ID,
      baseDeps({ verifyToken: verifyTokenReturning(memberIdentity({ uid: OTHER_MEMBER_UID, email: "other@example.com" })), docs }),
    );

    expect(result).toEqual({ ok: true });
    expect(decryptSpy).not.toHaveBeenCalled();
  });

  it("never logs on any success, rejection, or failure path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs: fakeForumReplyDocStore(activeReplyRecord()) }));
    await deleteReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      REPLY_ID,
      baseDeps({
        verifyToken: verifyTokenReturning(memberIdentity({ uid: OTHER_MEMBER_UID })),
        docs: fakeForumReplyDocStore(activeReplyRecord()),
      }),
    );
    await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, baseDeps({ docs: failingForumReplyDocStore() }));
    // The idempotent tombstone-retry path (BR-27, revised) — a different
    // non-admin caller retrying an already-tombstoned reply — must also
    // never log anything.
    await deleteReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      REPLY_ID,
      baseDeps({
        verifyToken: verifyTokenReturning(memberIdentity({ uid: OTHER_MEMBER_UID })),
        docs: fakeForumReplyDocStore(tombstoneReplyRecord()),
      }),
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("exposes no restore/undelete-shaped export from this module", () => {
    expect(Object.keys(deleteReplyModule).sort()).toEqual(["deleteReply"].sort());
  });

  // Closes the planning-review gap named in the implementation brief: a
  // reply is created via the real createReply, deleted via the real
  // deleteReply, and then read back through the real getThreadWithReplies —
  // proving the tombstone appears, contains no plaintext, and is never
  // passed to decrypt.
  describe("composed regression with the real createReply and getThreadWithReplies", () => {
    function createInMemoryRepliesStore() {
      const docs = new Map<string, Record<string, unknown>>();
      let counter = 0;
      return {
        async add(record: ActiveForumReply) {
          counter += 1;
          docs.set(`reply-${counter}`, { ...record });
        },
        async listOrderedForThread(threadId: string) {
          return [...docs.entries()]
            .filter(([, data]) => data.threadId === threadId)
            .sort((a, b) => (a[1].createdAt as Date).getTime() - (b[1].createdAt as Date).getTime())
            .map(([id, data]) => ({ id, data }));
        },
        async get(replyId: string) {
          const data = docs.get(replyId);
          return { exists: data !== undefined, data: () => data };
        },
        async tombstone(replyId: string, deletedAt: Date, deletedBy: string) {
          const existing = docs.get(replyId);
          docs.set(replyId, {
            teamId: existing?.teamId,
            threadId: existing?.threadId,
            createdAt: existing?.createdAt,
            deletedAt,
            deletedBy,
          });
        },
        lastId() {
          return `reply-${counter}`;
        },
      };
    }

    it("a reply created via createReply and deleted via deleteReply is returned as a content-free tombstone by getThreadWithReplies, with decrypt never called for it", async () => {
      const store = createInMemoryRepliesStore();
      const threadReader: ForumThreadReader = {
        async getThread() {
          return {
            teamId: TEAM_ID,
            authorUid: AUTHOR_UID,
            createdAt: new Date("2026-08-01T00:00:00Z"),
            ...encrypt(JSON.stringify({ title: "T", body: "B" })),
          };
        },
      };
      const authCollection: AuthorizeTeamAccessCollection = {
        async getTeamStatus() {
          return "active";
        },
        async getMembership(uid, teamId) {
          return uid === AUTHOR_UID && teamId === TEAM_ID ? { uid, teamId } : undefined;
        },
      };

      const created = await createReply("token", TEAM_ID, THREAD_ID, "A genuinely secret reply body", {
        verifyToken: verifyTokenReturning(memberIdentity()),
        membershipReader: {
          async getMembership(uid, teamId) {
            return uid === AUTHOR_UID && teamId === TEAM_ID ? { uid, teamId } : undefined;
          },
        },
        teamStatusReader: { async getTeamStatus() { return "active"; } },
        threadReader: {
          async getThread() {
            return {
              teamId: TEAM_ID,
              authorUid: AUTHOR_UID,
              createdAt: new Date("2026-08-01T00:00:00Z"),
              ...encrypt(JSON.stringify({ title: "T", body: "B" })),
            };
          },
        },
        replyCountReader: { async countRepliesForThread() { return 0; } },
        collection: store,
      });
      expect(created).toEqual({ ok: true });
      const replyId = store.lastId();

      const deleted = await deleteReply("token", TEAM_ID, THREAD_ID, replyId, {
        verifyToken: verifyTokenReturning(memberIdentity()),
        allowList: [ADMIN_EMAIL],
        docs: store,
        now: NOW,
      });
      expect(deleted).toEqual({ ok: true });

      const decryptCalls: EncryptedPayload[] = [];
      const decryptSpy = (payload: EncryptedPayload) => {
        decryptCalls.push(payload);
        return decrypt(payload);
      };

      const detail = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, {
        verifyToken: verifyTokenReturning(memberIdentity()),
        allowList: [ADMIN_EMAIL],
        authCollection,
        threadReader,
        repliesReader: store,
        decryptContent: decryptSpy,
      });

      expect(detail.ok).toBe(true);
      if (!detail.ok) throw new Error("expected ok result");
      const tombstoned = detail.replies.find((r) => r.replyId === replyId);
      expect(tombstoned).toEqual({
        replyId,
        isDeleted: true,
        body: null,
        authorTag: null,
        isOwnReply: false,
        createdAt: expect.any(String),
      });

      const serialized = JSON.stringify(detail);
      expect(serialized).not.toContain("A genuinely secret reply body");
      expect(serialized).not.toContain(AUTHOR_UID);

      // Only the thread's own content was ever decrypted — the tombstoned
      // reply has no ciphertext field to pass to decrypt at all.
      expect(decryptCalls).toHaveLength(1);
    });
  });
});

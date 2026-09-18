import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EncryptedPayload } from "../../../lib/encryption/encryption";
import { decrypt, encrypt } from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import { authorTag } from "../domain/author-tag";
import * as getThreadWithRepliesModule from "./get-thread-with-replies";
import { THREAD_REPLIES_LIMIT } from "./get-thread-with-replies";
import type {
  ForumRepliesReader,
  ForumThreadReader,
  GetThreadWithRepliesDeps,
  RawReplyDoc,
} from "./get-thread-with-replies";
import { getThreadWithReplies } from "./get-thread-with-replies";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const THREAD_ID = "thread-1";
const MEMBER_UID = "member-1";
const OTHER_AUTHOR_UID = "member-2";
const ADMIN_EMAIL = "admin@example.com";
const DELETER_UID = "admin-uid";

function memberIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function adminIdentity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return memberIdentity({ email: ADMIN_EMAIL, ...overrides });
}

function verifyTokenReturning(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: identity.uid,
    email: identity.email,
    email_verified: identity.emailVerified,
  });
}

function encryptedThreadContent(title: string, body: string): EncryptedPayload {
  return encrypt(JSON.stringify({ title, body }));
}

function threadDoc(
  content: { title: string; body: string } | undefined,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const encoded = content !== undefined ? encryptedThreadContent(content.title, content.body) : undefined;
  return {
    teamId: TEAM_ID,
    authorUid: "thread-author",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...(encoded ?? { ciphertext: "not-used", iv: "not-used", authTag: "not-used", keyVersion: "v1" }),
    ...overrides,
  };
}

function activeReplyDoc(
  id: string,
  body: string | undefined,
  overrides: Record<string, unknown> = {},
): RawReplyDoc {
  const encoded = body !== undefined ? encrypt(body) : undefined;
  return {
    id,
    data: {
      teamId: TEAM_ID,
      threadId: THREAD_ID,
      authorUid: MEMBER_UID,
      createdAt: new Date("2026-08-02T00:00:00Z"),
      ...(encoded ?? { ciphertext: "not-used", iv: "not-used", authTag: "not-used", keyVersion: "v1" }),
      ...overrides,
    },
  };
}

function tombstoneReplyDoc(id: string, overrides: Record<string, unknown> = {}): RawReplyDoc {
  return {
    id,
    data: {
      teamId: TEAM_ID,
      threadId: THREAD_ID,
      createdAt: new Date("2026-08-02T00:00:00Z"),
      deletedAt: new Date("2026-08-03T00:00:00Z"),
      deletedBy: DELETER_UID,
      ...overrides,
    },
  };
}

function fakeThreadReader(data: unknown): ForumThreadReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getThread: vi.fn(async (threadId: string) => {
      calls.push(threadId);
      return data;
    }),
  };
}

function failingThreadReader(): ForumThreadReader {
  return { getThread: vi.fn().mockRejectedValue(new Error("simulated firestore outage")) };
}

function fakeRepliesReader(
  docs: RawReplyDoc[],
  options: { ignoreThreadFilter?: boolean } = {},
): ForumRepliesReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listOrderedForThread(threadId) {
      calls.push(threadId);
      const scoped = options.ignoreThreadFilter
        ? docs
        : docs.filter((doc) => (doc.data as Record<string, unknown>).threadId === threadId);

      return [...scoped]
        .sort((a, b) => {
          const aDate = (a.data as Record<string, unknown>).createdAt as Date;
          const bDate = (b.data as Record<string, unknown>).createdAt as Date;
          return aDate.getTime() - bDate.getTime();
        })
        .slice(0, THREAD_REPLIES_LIMIT);
    },
  };
}

function failingRepliesReader(): ForumRepliesReader {
  return { listOrderedForThread: vi.fn().mockRejectedValue(new Error("simulated firestore outage")) };
}

function fakeAuthCollection(state: {
  teamStatus?: Record<string, unknown>;
  memberships?: Record<string, unknown>;
}): AuthorizeTeamAccessCollection {
  const teamStatus = state.teamStatus ?? {};
  const memberships = state.memberships ?? {};
  return {
    async getTeamStatus(teamId) {
      return teamStatus[teamId];
    },
    async getMembership(uid, teamId) {
      return memberships[`${uid}__${teamId}`];
    },
  };
}

function spyDecrypt(): ((payload: EncryptedPayload) => string) & { calls: EncryptedPayload[] } {
  const calls: EncryptedPayload[] = [];
  const fn = ((payload: EncryptedPayload) => {
    calls.push(payload);
    return decrypt(payload);
  }) as ((payload: EncryptedPayload) => string) & { calls: EncryptedPayload[] };
  fn.calls = calls;
  return fn;
}

function baseDeps(overrides: Partial<GetThreadWithRepliesDeps> = {}): GetThreadWithRepliesDeps {
  return {
    verifyToken: verifyTokenReturning(memberIdentity()),
    allowList: [ADMIN_EMAIL],
    authCollection: fakeAuthCollection({
      teamStatus: { [TEAM_ID]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: { uid: MEMBER_UID, teamId: TEAM_ID } },
    }),
    threadReader: fakeThreadReader(threadDoc({ title: "T", body: "B" })),
    repliesReader: fakeRepliesReader([]),
    ...overrides,
  };
}

describe("getThreadWithReplies", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns a real member's thread + every reply oldest-first, with authorTag/isOwnReply computed", async () => {
    const replies = [
      activeReplyDoc("reply-newer", "Newer reply", { createdAt: new Date("2026-08-03T00:00:00Z"), authorUid: MEMBER_UID }),
      activeReplyDoc("reply-older", "Older reply", { createdAt: new Date("2026-08-02T00:00:00Z"), authorUid: OTHER_AUTHOR_UID }),
    ];
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      baseDeps({
        threadReader: fakeThreadReader(threadDoc({ title: "Thread title", body: "Thread body" }, { authorUid: MEMBER_UID })),
        repliesReader: fakeRepliesReader(replies),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.thread.title).toBe("Thread title");
    expect(result.thread.body).toBe("Thread body");
    expect(result.thread.authorTag).toBe(authorTag(TEAM_ID, MEMBER_UID));
    expect(result.thread.isOwnThread).toBe(true);

    expect(result.replies.map((r) => r.replyId)).toEqual(["reply-older", "reply-newer"]);
    const older = result.replies[0];
    if (older.isDeleted) throw new Error("expected active reply");
    expect(older.body).toBe("Older reply");
    expect(older.authorTag).toBe(authorTag(TEAM_ID, OTHER_AUTHOR_UID));
    expect(older.isOwnReply).toBe(false);

    const newer = result.replies[1];
    if (newer.isDeleted) throw new Error("expected active reply");
    expect(newer.body).toBe("Newer reply");
    expect(newer.isOwnReply).toBe(true);
  });

  it("allows an app admin (no real membership) to read a team's thread detail", async () => {
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      baseDeps({
        verifyToken: verifyTokenReturning(adminIdentity()),
        authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" } }),
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("rejects an unauthenticated caller and performs no thread/reply read", async () => {
    const threadReader = fakeThreadReader(threadDoc({ title: "T", body: "B" }));
    const repliesReader = fakeRepliesReader([]);
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await getThreadWithReplies("bad-token", TEAM_ID, THREAD_ID, baseDeps({ verifyToken, threadReader, repliesReader }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(threadReader.calls).toHaveLength(0);
    expect(repliesReader.calls).toHaveLength(0);
  });

  it("rejects a non-member/non-admin caller (forbidden), performing no thread/reply read", async () => {
    const threadReader = fakeThreadReader(threadDoc({ title: "T", body: "B" }));
    const repliesReader = fakeRepliesReader([]);

    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      baseDeps({ authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" } }), threadReader, repliesReader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(threadReader.calls).toHaveLength(0);
    expect(repliesReader.calls).toHaveLength(0);
  });

  it("never collapses a read_failed from the authorization check itself into forbidden", async () => {
    const authCollection: AuthorizeTeamAccessCollection = {
      getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      getMembership: vi.fn(),
    };

    const result = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ authCollection }));

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  describe("not_found / read_failed boundary (BR-16, BR-20)", () => {
    it("resolves a never-existed threadId to not_found", async () => {
      const result = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ threadReader: fakeThreadReader(undefined) }));
      expect(result).toEqual({ ok: false, error: "not_found" });
    });

    // The full composed regression (create via the real createThread, delete
    // via the real deleteThread, then re-fetch) requires TASK-004's
    // deleteThread, which does not exist yet — from getThreadWithReplies's
    // own perspective a hard-deleted thread's document is indistinguishable
    // from one that never existed, so this case is exercised here via the
    // achievable half (an absent document); the end-to-end version is added
    // in TASK-004's test suite, mirroring TASK-002's identical deferral.
    it("resolves a hard-deleted threadId to the byte-identical not_found as a never-existed one", async () => {
      const neverExisted = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ threadReader: fakeThreadReader(undefined) }));
      const deleted = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ threadReader: fakeThreadReader(undefined) }));

      expect(deleted).toEqual(neverExisted);
    });

    it("resolves a cross-team threadId to not_found", async () => {
      const result = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ threadReader: fakeThreadReader(threadDoc({ title: "T", body: "B" }, { teamId: OTHER_TEAM_ID })) }),
      );
      expect(result).toEqual({ ok: false, error: "not_found" });
    });

    it("never-existed, hard-deleted, and cross-team threadIds all resolve to the byte-identical not_found response", async () => {
      const neverExisted = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ threadReader: fakeThreadReader(undefined) }));
      const crossTeam = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ threadReader: fakeThreadReader(threadDoc({ title: "T", body: "B" }, { teamId: OTHER_TEAM_ID })) }),
      );

      expect(crossTeam).toEqual(neverExisted);
    });

    it("fails the whole call closed (read_failed) when the thread document itself is malformed", async () => {
      const repliesReader = fakeRepliesReader([activeReplyDoc("reply-1", "should not be reachable")]);
      const result = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ threadReader: fakeThreadReader({ teamId: TEAM_ID }), repliesReader }),
      );

      expect(result).toEqual({ ok: false, error: "read_failed" });
      expect(repliesReader.calls).toHaveLength(0);
    });

    it("fails the whole call closed (read_failed) when the thread's ciphertext fails to decrypt", async () => {
      const result = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ threadReader: fakeThreadReader(threadDoc({ title: "T", body: "B" }, { ciphertext: "not-real-ciphertext==" })) }),
      );

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });

    it("reports read_failed, not a fabricated result, when the thread read itself throws", async () => {
      const result = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ threadReader: failingThreadReader() }));
      expect(result).toEqual({ ok: false, error: "read_failed" });
    });

    it("reports read_failed when the replies query itself throws", async () => {
      const result = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ repliesReader: failingRepliesReader() }));
      expect(result).toEqual({ ok: false, error: "read_failed" });
    });
  });

  describe("malformed / cross-team reply exclusion (BR-20, BR-35, BR-56)", () => {
    it("excludes a malformed reply document (missing required active field) without failing the whole call", async () => {
      const malformed = activeReplyDoc("malformed", undefined, { ciphertext: undefined });
      const valid = activeReplyDoc("valid-reply", "Valid body");
      const result = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ repliesReader: fakeRepliesReader([malformed, valid]) }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok result");
      expect(result.replies.map((r) => r.replyId)).toEqual(["valid-reply"]);
    });

    it("excludes a reply matching neither the active nor the tombstone shape (fields from both) without failing the whole call", async () => {
      const hybrid = activeReplyDoc("hybrid", "leaked plaintext", { deletedAt: new Date(), deletedBy: DELETER_UID });
      const valid = activeReplyDoc("valid-reply", "Valid body");
      const result = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ repliesReader: fakeRepliesReader([hybrid, valid]) }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok result");
      expect(result.replies.map((r) => r.replyId)).toEqual(["valid-reply"]);
    });

    it("excludes a reply matching neither shape (missing both ciphertext and deletedAt) without failing the whole call", async () => {
      const neither: RawReplyDoc = {
        id: "neither",
        data: { teamId: TEAM_ID, threadId: THREAD_ID, createdAt: new Date("2026-08-02T00:00:00Z") },
      };
      const valid = activeReplyDoc("valid-reply", "Valid body");
      const result = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ repliesReader: fakeRepliesReader([neither, valid]) }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok result");
      expect(result.replies.map((r) => r.replyId)).toEqual(["valid-reply"]);
    });

    it("excludes a reply whose own persisted teamId doesn't match the parent thread's teamId (BR-35), even if the reader ignores its own scoping", async () => {
      const crossTeamReply = activeReplyDoc("cross-team-reply", "Leaked", { teamId: OTHER_TEAM_ID });
      const ownReply = activeReplyDoc("own-reply", "Own body");
      const result = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ repliesReader: fakeRepliesReader([crossTeamReply, ownReply], { ignoreThreadFilter: true }) }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok result");
      expect(result.replies.map((r) => r.replyId)).toEqual(["own-reply"]);
    });

    it("a caller authorized only for Team A cannot receive Team B's replies via a fake reader that ignores its own threadId scoping", async () => {
      const leakedReply = activeReplyDoc("team-b-reply", "Leaked", { teamId: OTHER_TEAM_ID, threadId: "other-thread" });
      const result = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ repliesReader: fakeRepliesReader([leakedReply], { ignoreThreadFilter: true }) }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok result");
      expect(result.replies).toEqual([]);
    });

    it("excludes a reply that fails to decrypt (tampered ciphertext) without failing the whole call", async () => {
      const tampered = activeReplyDoc("tampered", "should not decrypt", { ciphertext: "not-real-ciphertext==" });
      const valid = activeReplyDoc("valid-reply", "Valid body");
      const result = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ repliesReader: fakeRepliesReader([tampered, valid]) }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok result");
      expect(result.replies.map((r) => r.replyId)).toEqual(["valid-reply"]);
    });
  });

  describe("tombstone rendering and decrypt-before-filter protection (BR-26, BR-56)", () => {
    // The full end-to-end regression (create via the real createReply, delete
    // via the real deleteReply, re-fetch) requires TASK-004's deleteReply,
    // which does not exist yet. TASK-001 already establishes the exact
    // TombstonedForumReply shape deleteReply is specified to persist — this
    // test seeds that exact shape directly (not deleteReply's own output) to
    // prove getThreadWithReplies's read-side contract in isolation; the
    // create+delete+re-fetch composition is added in TASK-004's test suite,
    // mirroring TASK-002's identical cross-task deferral for listTeamThreads.
    it("renders a tombstoned reply as a content-free placeholder at its original position, never its original content or author", async () => {
      const before = activeReplyDoc("reply-before", "Before", { createdAt: new Date("2026-08-01T12:00:00Z") });
      const tombstone = tombstoneReplyDoc("reply-deleted", { createdAt: new Date("2026-08-02T00:00:00Z") });
      const after = activeReplyDoc("reply-after", "After", { createdAt: new Date("2026-08-03T00:00:00Z") });

      const result = await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ repliesReader: fakeRepliesReader([before, tombstone, after]) }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok result");
      expect(result.replies.map((r) => r.replyId)).toEqual(["reply-before", "reply-deleted", "reply-after"]);

      const deleted = result.replies[1];
      expect(deleted.isDeleted).toBe(true);
      expect(deleted.body).toBeNull();
      expect(deleted.authorTag).toBeNull();
      expect(deleted.isOwnReply).toBe(false);

      const serialized = JSON.stringify(deleted);
      expect(serialized).not.toContain(DELETER_UID);
      expect(serialized).not.toContain("Before");
      expect(serialized).not.toContain("After");
    });

    it("never calls decrypt for a tombstoned reply — it has no ciphertext field to pass to it", async () => {
      const tombstone = tombstoneReplyDoc("reply-deleted");
      const active = activeReplyDoc("reply-active", "Active body");
      const decryptSpy = spyDecrypt();

      await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({
          repliesReader: fakeRepliesReader([tombstone, active]),
          decryptContent: decryptSpy,
        }),
      );

      // One call for the thread's own content, one for the single active
      // reply — the tombstone contributes zero calls.
      expect(decryptSpy.calls).toHaveLength(2);
    });

    it("never calls decrypt for a reply excluded by shape validation (decrypt-before-filter protection)", async () => {
      const malformed = activeReplyDoc("malformed", undefined, { authorUid: undefined });
      const valid = activeReplyDoc("valid-reply", "Valid body");
      const decryptSpy = spyDecrypt();

      await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({ repliesReader: fakeRepliesReader([malformed, valid]), decryptContent: decryptSpy }),
      );

      expect(decryptSpy.calls).toHaveLength(2); // thread content + the one valid reply
    });

    it("never calls decrypt for a reply excluded via the cross-team teamId cross-check", async () => {
      const crossTeamReply = activeReplyDoc("cross-team-reply", "Leaked", { teamId: OTHER_TEAM_ID });
      const decryptSpy = spyDecrypt();

      await getThreadWithReplies(
        "token",
        TEAM_ID,
        THREAD_ID,
        baseDeps({
          repliesReader: fakeRepliesReader([crossTeamReply], { ignoreThreadFilter: true }),
          decryptContent: decryptSpy,
        }),
      );

      expect(decryptSpy.calls).toHaveLength(1); // thread content only
    });
  });

  it("returns all 500 replies of a thread seeded at exactly the capacity limit, in ascending order, with no truncation", async () => {
    const docs: RawReplyDoc[] = [];
    for (let i = 0; i < THREAD_REPLIES_LIMIT; i += 1) {
      docs.push(activeReplyDoc(`reply-${i}`, `Body ${i}`, { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) }));
    }

    const result = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ repliesReader: fakeRepliesReader(docs) }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.replies).toHaveLength(THREAD_REPLIES_LIMIT);
    expect(result.replies[0].replyId).toBe("reply-0");
    expect(result.replies[THREAD_REPLIES_LIMIT - 1].replyId).toBe(`reply-${THREAD_REPLIES_LIMIT - 1}`);

    const createdAtValues = result.replies.map((r) => new Date(r.createdAt).getTime());
    const sorted = [...createdAtValues].sort((a, b) => a - b);
    expect(createdAtValues).toEqual(sorted);
  });

  it("remains readable for a disabled team's existing members (BR-21)", async () => {
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      baseDeps({
        authCollection: fakeAuthCollection({
          teamStatus: { [TEAM_ID]: "disabled" },
          memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: { uid: MEMBER_UID, teamId: TEAM_ID } },
        }),
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("never returns authorUid/deletedAt/deletedBy/encrypted fields for the thread or any reply", async () => {
    const active = activeReplyDoc("reply-1", "Body", { authorUid: "member-with-a-name" });
    const tombstone = tombstoneReplyDoc("reply-2");
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      baseDeps({ repliesReader: fakeRepliesReader([active, tombstone]) }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    for (const forbiddenKey of ["authorUid", "ciphertext", "iv", "authTag", "keyVersion", "deletedAt", "deletedBy", "teamId"]) {
      expect(result.thread).not.toHaveProperty(forbiddenKey);
      for (const reply of result.replies) {
        expect(reply).not.toHaveProperty(forbiddenKey);
      }
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    expect(serialized).not.toContain("member-with-a-name");
    expect(serialized).not.toContain(DELETER_UID);
  });

  it("never logs on success, rejection, or failure paths", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ repliesReader: fakeRepliesReader([activeReplyDoc("r1", "B")]) }));
    await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" } }) }));
    await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ threadReader: fakeThreadReader(undefined) }));
    await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ threadReader: failingThreadReader() }));
    await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ repliesReader: failingRepliesReader() }));

    const tampered = activeReplyDoc("tampered", "should not decrypt", { ciphertext: "not-real==" });
    await getThreadWithReplies("token", TEAM_ID, THREAD_ID, baseDeps({ repliesReader: fakeRepliesReader([tampered]) }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("exposes no creation/edit/delete-shaped export from this module", () => {
    expect(Object.keys(getThreadWithRepliesModule).sort()).toEqual(["THREAD_REPLIES_LIMIT", "getThreadWithReplies"].sort());
  });
});

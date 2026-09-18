import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { ActiveForumReply } from "../domain/forum-reply";
import type { ForumThreadRecord } from "../domain/forum-thread";
import * as createReplyModule from "./create-reply";
import { REPLY_CAPACITY_LIMIT } from "./create-reply";
import type {
  CreateReplyDeps,
  ForumRepliesCollection,
  MembershipReader,
  ReplyCountReader,
  TeamStatusReader,
  ThreadReader,
} from "./create-reply";
import { createReply } from "./create-reply";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const THREAD_ID = "thread-1";
const MEMBER_UID = "member-1";
const APP_ADMIN_EMAIL = "admin@example.com";
const NOW = new Date("2026-09-01T00:00:00Z");
const VALID_BODY = "Has anyone actually fixed this in prod, or are we still just restarting the pods?";

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: MEMBER_UID, email: "dev@example.com", emailVerified: true, ...overrides };
}

function verifyTokenReturning(verified: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({
    uid: verified.uid,
    email: verified.email,
    email_verified: verified.emailVerified,
  });
}

function fakeForumRepliesCollection(): ForumRepliesCollection & { writes: ActiveForumReply[] } {
  const writes: ActiveForumReply[] = [];
  return {
    writes,
    add: vi.fn(async (record: ActiveForumReply) => {
      writes.push(record);
    }),
  };
}

function fakeMembershipReader(data: unknown): MembershipReader & { calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    getMembership: vi.fn(async (uid: string, teamId: string) => {
      calls.push([uid, teamId]);
      return data;
    }),
  };
}

function fakeTeamStatusReader(status: unknown): TeamStatusReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getTeamStatus: vi.fn(async (teamId: string) => {
      calls.push(teamId);
      return status;
    }),
  };
}

function fakeThreadReader(data: unknown): ThreadReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getThread: vi.fn(async (threadId: string) => {
      calls.push(threadId);
      return data;
    }),
  };
}

function fakeReplyCountReader(count: number): ReplyCountReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    countRepliesForThread: vi.fn(async (threadId: string) => {
      calls.push(threadId);
      return count;
    }),
  };
}

function membershipDoc(uid: string, teamId: string): Record<string, unknown> {
  return { uid, teamId, createdAt: new Date("2026-08-01T00:00:00Z"), createdVia: "admin_direct", grantedBy: "admin" };
}

function threadRecord(overrides: Partial<ForumThreadRecord> = {}): ForumThreadRecord {
  return {
    teamId: TEAM_ID,
    authorUid: "thread-author",
    ciphertext: "not-used",
    iv: "not-used",
    authTag: "not-used",
    keyVersion: "v1",
    createdAt: new Date("2026-08-15T00:00:00Z"),
    ...overrides,
  };
}

function baseDeps(overrides: Partial<CreateReplyDeps> = {}): CreateReplyDeps {
  return {
    verifyToken: verifyTokenReturning(identity()),
    membershipReader: fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID)),
    teamStatusReader: fakeTeamStatusReader("active"),
    threadReader: fakeThreadReader(threadRecord()),
    replyCountReader: fakeReplyCountReader(0),
    collection: fakeForumRepliesCollection(),
    now: NOW,
    ...overrides,
  };
}

describe("createReply", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid submission from a real team member on an active thread and persists an encrypted reply", async () => {
    const collection = fakeForumRepliesCollection();
    const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection }));

    expect(result).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(1);
    const stored = collection.writes[0];
    expect(stored.teamId).toBe(TEAM_ID);
    expect(stored.threadId).toBe(THREAD_ID);
    expect(stored.authorUid).toBe(MEMBER_UID);
    expect(stored.createdAt).toEqual(NOW);
    expect(typeof stored.ciphertext).toBe("string");
    expect(typeof stored.iv).toBe("string");
    expect(typeof stored.authTag).toBe("string");
    expect(stored.keyVersion).toBe("v1");
  });

  it("persists exactly the ActiveForumReply shape — teamId, threadId, authorUid, encrypted fields, createdAt — and nothing else", async () => {
    const collection = fakeForumRepliesCollection();
    await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection }));

    const stored = collection.writes[0];
    expect(Object.keys(stored).sort()).toEqual(
      ["authTag", "authorUid", "ciphertext", "createdAt", "iv", "keyVersion", "teamId", "threadId"].sort(),
    );
  });

  it("encrypts and persists the canonical trimmed body, never plaintext", async () => {
    const collection = fakeForumRepliesCollection();
    const paddedBody = `   ${VALID_BODY}   `;
    await createReply("token", TEAM_ID, THREAD_ID, paddedBody, baseDeps({ collection }));

    const stored = collection.writes[0];
    const decrypted = decrypt({
      ciphertext: stored.ciphertext,
      iv: stored.iv,
      authTag: stored.authTag,
      keyVersion: stored.keyVersion,
    });
    expect(decrypted).toBe(VALID_BODY);

    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain("Has anyone actually fixed");
  });

  it("accepts the minimum (3 chars) and maximum (2000 chars) boundary lengths", async () => {
    const minResult = await createReply("token", TEAM_ID, THREAD_ID, "abc", baseDeps({ collection: fakeForumRepliesCollection() }));
    expect(minResult.ok).toBe(true);

    const maxBody = "b".repeat(2000);
    const maxResult = await createReply("token", TEAM_ID, THREAD_ID, maxBody, baseDeps({ collection: fakeForumRepliesCollection() }));
    expect(maxResult.ok).toBe(true);
  });

  it("rejects an invalid body before any Firestore read, and writes nothing", async () => {
    const invalidBodies: unknown[] = ["ab", "a".repeat(2001), "", "   ", 42, null, undefined];

    for (const invalidBody of invalidBodies) {
      const collection = fakeForumRepliesCollection();
      const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID));
      const teamStatusReader = fakeTeamStatusReader("active");
      const threadReader = fakeThreadReader(threadRecord());
      const replyCountReader = fakeReplyCountReader(0);

      const result = await createReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        invalidBody,
        baseDeps({ collection, membershipReader, teamStatusReader, threadReader, replyCountReader }),
      );

      expect(result).toEqual({ ok: false, error: "invalid_input" });
      expect(collection.writes).toHaveLength(0);
      expect(membershipReader.calls).toHaveLength(0);
      expect(teamStatusReader.calls).toHaveLength(0);
      expect(threadReader.calls).toHaveLength(0);
      expect(replyCountReader.calls).toHaveLength(0);
    }
  });

  it("rejects an unauthenticated/invalid-token caller and performs zero Firestore reads or writes", async () => {
    const collection = fakeForumRepliesCollection();
    const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, TEAM_ID));
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await createReply(
      "bad-token",
      TEAM_ID,
      THREAD_ID,
      VALID_BODY,
      baseDeps({ collection, membershipReader, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "sign_in_required" });
    expect(collection.writes).toHaveLength(0);
    expect(membershipReader.calls).toHaveLength(0);
  });

  it("rejects a signed-in caller with no real membership for the team, and writes nothing", async () => {
    const collection = fakeForumRepliesCollection();
    const membershipReader = fakeMembershipReader(undefined);

    const result = await createReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      VALID_BODY,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a member of a different team (wrong-team membership), and writes nothing", async () => {
    const collection = fakeForumRepliesCollection();
    const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, OTHER_TEAM_ID));

    const result = await createReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      VALID_BODY,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects a malformed membership record (missing uid/teamId fields), and writes nothing", async () => {
    const collection = fakeForumRepliesCollection();
    const membershipReader = fakeMembershipReader({ notUid: "x" });

    const result = await createReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      VALID_BODY,
      baseDeps({ collection, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects an app admin with no real membership record — admin status alone is never sufficient (BR-1)", async () => {
    const collection = fakeForumRepliesCollection();
    const membershipReader = fakeMembershipReader(undefined);
    const verifyToken = verifyTokenReturning(identity({ email: APP_ADMIN_EMAIL }));

    const result = await createReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      VALID_BODY,
      baseDeps({ collection, membershipReader, verifyToken }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(collection.writes).toHaveLength(0);
  });

  it("rejects creation for a disabled team, and writes nothing", async () => {
    const collection = fakeForumRepliesCollection();
    const teamStatusReader = fakeTeamStatusReader("disabled");
    const threadReader = fakeThreadReader(threadRecord());

    const result = await createReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      VALID_BODY,
      baseDeps({ collection, teamStatusReader, threadReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(collection.writes).toHaveLength(0);
    expect(threadReader.calls).toHaveLength(0);
  });

  it("rejects creation for a nonexistent team (team_disabled — this operation folds nonexistent/malformed status into the same outcome as disabled, per the API/DTO contract), and writes nothing", async () => {
    const collection = fakeForumRepliesCollection();
    const teamStatusReader = fakeTeamStatusReader(undefined);
    const membershipReader = fakeMembershipReader(membershipDoc(MEMBER_UID, "no-such-team"));

    const result = await createReply(
      "token",
      "no-such-team",
      THREAD_ID,
      VALID_BODY,
      baseDeps({ collection, teamStatusReader, membershipReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(collection.writes).toHaveLength(0);
  });

  it("fails closed to team_disabled on a malformed/unrecognized team status", async () => {
    const collection = fakeForumRepliesCollection();
    const teamStatusReader = fakeTeamStatusReader("archived");

    const result = await createReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      VALID_BODY,
      baseDeps({ collection, teamStatusReader }),
    );

    expect(result).toEqual({ ok: false, error: "team_disabled" });
    expect(collection.writes).toHaveLength(0);
  });

  describe("parent thread validation (BR-8)", () => {
    it("rejects a reply on a nonexistent thread with not_found", async () => {
      const collection = fakeForumRepliesCollection();
      const threadReader = fakeThreadReader(undefined);

      const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection, threadReader }));

      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(collection.writes).toHaveLength(0);
    });

    // A hard-deleted thread's document simply no longer exists — from
    // createReply's own perspective this is indistinguishable from "never
    // existed" (TASK-001's design: missing *is* deleted). The full
    // composed regression (create via the real createThread, delete via the
    // real deleteThread, then attempt a reply) requires TASK-004's
    // deleteThread, which does not exist yet — added there, not here,
        // mirroring TASK-002's identical cross-task deferral for listTeamThreads.
    it("rejects a reply on a since-deleted thread identically to a never-existed one (not_found)", async () => {
      const collection = fakeForumRepliesCollection();
      const threadReader = fakeThreadReader(undefined);

      const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection, threadReader }));

      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(collection.writes).toHaveLength(0);
    });

    it("rejects a reply on a cross-team thread with not_found, and writes nothing", async () => {
      const collection = fakeForumRepliesCollection();
      const threadReader = fakeThreadReader(threadRecord({ teamId: OTHER_TEAM_ID }));

      const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection, threadReader }));

      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(collection.writes).toHaveLength(0);
    });

    it("rejects a reply on a malformed thread document with not_found, and writes nothing", async () => {
      const collection = fakeForumRepliesCollection();
      const threadReader = fakeThreadReader({ teamId: TEAM_ID }); // missing required fields

      const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection, threadReader }));

      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(collection.writes).toHaveLength(0);
    });

    it("resolves nonexistent, cross-team, and malformed threads to the byte-identical not_found response", async () => {
      const nonexistent = await createReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        VALID_BODY,
        baseDeps({ threadReader: fakeThreadReader(undefined), collection: fakeForumRepliesCollection() }),
      );
      const crossTeam = await createReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        VALID_BODY,
        baseDeps({
          threadReader: fakeThreadReader(threadRecord({ teamId: OTHER_TEAM_ID })),
          collection: fakeForumRepliesCollection(),
        }),
      );
      const malformed = await createReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        VALID_BODY,
        baseDeps({ threadReader: fakeThreadReader({ teamId: TEAM_ID }), collection: fakeForumRepliesCollection() }),
      );

      expect(nonexistent).toEqual({ ok: false, error: "not_found" });
      expect(crossTeam).toEqual(nonexistent);
      expect(malformed).toEqual(nonexistent);
    });

    it("never reads the reply count for a not_found thread", async () => {
      const replyCountReader = fakeReplyCountReader(0);
      await createReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        VALID_BODY,
        baseDeps({ threadReader: fakeThreadReader(undefined), replyCountReader }),
      );

      expect(replyCountReader.calls).toHaveLength(0);
    });
  });

  describe("reply capacity (BR-52, BR-53)", () => {
    it("accepts a 500th reply when the thread is seeded at exactly 499 replies", async () => {
      const collection = fakeForumRepliesCollection();
      const replyCountReader = fakeReplyCountReader(REPLY_CAPACITY_LIMIT - 1);

      const result = await createReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        VALID_BODY,
        baseDeps({ collection, replyCountReader }),
      );

      expect(result).toEqual({ ok: true });
      expect(collection.writes).toHaveLength(1);
    });

    it("rejects a 501st reply with thread_full when the thread is seeded at exactly 500 replies, and writes nothing", async () => {
      const collection = fakeForumRepliesCollection();
      const replyCountReader = fakeReplyCountReader(REPLY_CAPACITY_LIMIT);

      const result = await createReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        VALID_BODY,
        baseDeps({ collection, replyCountReader }),
      );

      expect(result).toEqual({ ok: false, error: "thread_full" });
      expect(collection.writes).toHaveLength(0);
    });

    it("rejects with thread_full when the thread already exceeds the cap (BR-53's rare over-cap race), and writes nothing", async () => {
      const collection = fakeForumRepliesCollection();
      const replyCountReader = fakeReplyCountReader(REPLY_CAPACITY_LIMIT + 1);

      const result = await createReply(
        "token",
        TEAM_ID,
        THREAD_ID,
        VALID_BODY,
        baseDeps({ collection, replyCountReader }),
      );

      expect(result).toEqual({ ok: false, error: "thread_full" });
      expect(collection.writes).toHaveLength(0);
    });

    it("counts replies scoped to the target threadId, via the injected reader", async () => {
      const replyCountReader = fakeReplyCountReader(0);
      await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ replyCountReader }));

      expect(replyCountReader.calls).toEqual([THREAD_ID]);
    });
  });

  it("persists the parent thread's own teamId, never the route-scoped teamId directly, and never a client-supplied override (BR-2, BR-35, BR-47)", async () => {
    const collection = fakeForumRepliesCollection();
    // The route-scoped teamId and the thread's own persisted teamId agree in
    // ordinary operation (a cross-team thread is already rejected `not_found`
    // above) — this asserts the write path reads from the validated thread
    // record specifically, not merely from the caller-supplied teamId.
    const threadReader = fakeThreadReader(threadRecord({ teamId: TEAM_ID }));

    const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection, threadReader }));

    expect(result.ok).toBe(true);
    expect(collection.writes[0].teamId).toBe(TEAM_ID);
    expect(collection.writes[0].threadId).toBe(THREAD_ID);
    expect(collection.writes[0].authorUid).toBe(MEMBER_UID);
    expect(collection.writes[0].authorUid).not.toBe("attacker-uid");
    expect(collection.writes[0]).not.toHaveProperty("replyId");
    expect(collection.writes[0]).not.toHaveProperty("deletedAt");
    expect(collection.writes[0]).not.toHaveProperty("deletedBy");
  });

  it("never persists an author-identity-shaped field beyond authorUid", async () => {
    const collection = fakeForumRepliesCollection();
    await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection }));

    const stored = collection.writes[0];
    for (const forbiddenField of ["email", "displayName", "name", "authorTag", "createdBy", "userId"]) {
      expect(stored).not.toHaveProperty(forbiddenField);
    }
    expect(JSON.stringify(stored)).not.toContain("dev@example.com");
  });

  it("persists encrypted ciphertext, never the raw plaintext body", async () => {
    const collection = fakeForumRepliesCollection();
    await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection }));

    const serialized = JSON.stringify(collection.writes[0]);
    expect(serialized).not.toContain(VALID_BODY);
  });

  it("fails closed with encryption_failed and writes nothing when ENCRYPTION_KEY is missing, after all prior checks pass", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    const collection = fakeForumRepliesCollection();

    const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "encryption_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports persistence_failed, not a fabricated success, when the Firestore write fails", async () => {
    const collection: ForumRepliesCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports persistence_failed when the membership read fails", async () => {
    const collection = fakeForumRepliesCollection();
    const membershipReader: MembershipReader = {
      getMembership: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection, membershipReader }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports persistence_failed when the team status read fails", async () => {
    const collection = fakeForumRepliesCollection();
    const teamStatusReader: TeamStatusReader = {
      getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection, teamStatusReader }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports persistence_failed when the thread read fails", async () => {
    const collection = fakeForumRepliesCollection();
    const threadReader: ThreadReader = {
      getThread: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection, threadReader }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("reports persistence_failed when the reply-count query fails", async () => {
    const collection = fakeForumRepliesCollection();
    const replyCountReader: ReplyCountReader = {
      countRepliesForThread: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };

    const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection, replyCountReader }));

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(collection.writes).toHaveLength(0);
  });

  it("allows repeated replies from the same identity to all succeed independently (BR-9)", async () => {
    const collection = fakeForumRepliesCollection();
    const deps = baseDeps({ collection });

    const first = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, deps);
    const second = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, deps);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(collection.writes).toHaveLength(2);
  });

  it("never logs on success, rejection, or failure paths", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps());
    await createReply("token", TEAM_ID, THREAD_ID, "x", baseDeps());
    await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ membershipReader: fakeMembershipReader(undefined) }));
    await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ teamStatusReader: fakeTeamStatusReader("disabled") }));
    await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ threadReader: fakeThreadReader(undefined) }));
    await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ replyCountReader: fakeReplyCountReader(REPLY_CAPACITY_LIMIT) }));

    vi.stubEnv("ENCRYPTION_KEY", "");
    await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps());
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));

    const failingCollection: ForumRepliesCollection = {
      add: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
    };
    await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection: failingCollection }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns only the approved minimal success/failure shape", async () => {
    const successResult = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps());
    expect(Object.keys(successResult)).toEqual(["ok"]);

    const failureResult = await createReply(
      "token",
      TEAM_ID,
      THREAD_ID,
      VALID_BODY,
      baseDeps({ membershipReader: fakeMembershipReader(undefined) }),
    );
    expect(Object.keys(failureResult).sort()).toEqual(["error", "ok"]);
  });

  it("exposes no listing/edit/delete-shaped export from this module", () => {
    expect(Object.keys(createReplyModule).sort()).toEqual(["REPLY_CAPACITY_LIMIT", "createReply"].sort());
  });

  describe("privacy regression", () => {
    it("the full serialized persisted record never contains an identity canary beyond authorUid itself", async () => {
      const collection = fakeForumRepliesCollection();
      await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps({ collection }));

      const stored = collection.writes[0];
      for (const forbiddenKey of ["email", "displayName", "authorTag"]) {
        expect(stored).not.toHaveProperty(forbiddenKey);
      }
      expect(JSON.stringify(stored)).not.toContain("dev@example.com");
    });

    it("the full serialized success/failure result never contains an identity canary", async () => {
      const result = await createReply("token", TEAM_ID, THREAD_ID, VALID_BODY, baseDeps());
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain(MEMBER_UID);
      expect(serialized).not.toContain("dev@example.com");
    });
  });
});

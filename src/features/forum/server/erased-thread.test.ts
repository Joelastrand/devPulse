import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptRecord, encryptRecord } from "../../../lib/encryption/record-envelope";
import { forumReplyContext } from "../domain/forum-reply";
import { forumThreadContext } from "../domain/forum-thread";
import { authorTag } from "../domain/author-tag";
import type { ErasedForumThreadRecord } from "../domain/forum-erased-thread";
import { createReply, type CreateReplyDeps, type ForumRepliesCollection, type MembershipReader, type TeamStatusReader } from "./create-reply";
import { getThreadWithReplies, type ForumRepliesReader, type ForumThreadReader, type GetThreadWithRepliesDeps, type RawReplyDoc } from "./get-thread-with-replies";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";

// TASK-015: the erased-thread placeholder read path and its reply refusal. Fixtures are synthetic.

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const THREAD_ID = "thread-1";
const MEMBER_UID = "member-1";
const OTHER_MEMBER_UID = "member-2";
const ERASED_UID = "erased-uid";
const CREATED = new Date("2026-08-01T00:00:00Z");

const FORBIDDEN_KEYS = ["title", "body", "authorTag", "isOwnThread", "authorUid", "ciphertext", "iv", "authTag"];

function placeholder(overrides: Record<string, unknown> = {}): ErasedForumThreadRecord {
  return { teamId: TEAM_ID, createdAt: CREATED, erasedAt: new Date("2026-10-01T00:00:00Z"), status: "erased", ...overrides } as ErasedForumThreadRecord;
}

function verifyAs(uid: string) {
  return vi.fn().mockResolvedValue({ uid, email: `${uid}@example.com`, email_verified: true });
}

function threadReader(data: unknown): ForumThreadReader {
  return { getThread: vi.fn(async () => data) };
}

function repliesReader(docs: RawReplyDoc[]): ForumRepliesReader {
  return {
    listOrderedForThread: vi.fn(async () =>
      [...docs].sort((a, b) => (a.data as { createdAt: Date }).createdAt.getTime() - (b.data as { createdAt: Date }).createdAt.getTime()),
    ),
  };
}

function activeReply(id: string, authorUid: string, body: string, createdAt: string): RawReplyDoc {
  const encoded = encryptRecord(body, forumReplyContext(TEAM_ID, THREAD_ID, id));
  return {
    id,
    data: { teamId: TEAM_ID, threadId: THREAD_ID, authorUid, createdAt: new Date(createdAt), ...encoded },
  };
}

function tombstone(id: string, createdAt: string): RawReplyDoc {
  return {
    id,
    data: {
      teamId: TEAM_ID,
      threadId: THREAD_ID,
      createdAt: new Date(createdAt),
      deletedAt: new Date("2026-08-05T00:00:00Z"),
      deletedBy: ERASED_UID,
    },
  };
}

function accessCollection(): AuthorizeTeamAccessCollection {
  return {
    async getTeamStatus(teamId) {
      return teamId === TEAM_ID ? "active" : undefined;
    },
    async getMembership(uid, teamId) {
      return uid === MEMBER_UID && teamId === TEAM_ID ? { uid, teamId } : undefined;
    },
  };
}

function readDeps(overrides: Partial<GetThreadWithRepliesDeps> = {}): GetThreadWithRepliesDeps {
  return {
    verifyToken: verifyAs(MEMBER_UID),
    isSuperadmin: async () => false,
    authCollection: accessCollection(),
    threadReader: threadReader(placeholder()),
    repliesReader: repliesReader([]),
    ...overrides,
  };
}

describe("getThreadWithReplies on an erased-thread placeholder (TASK-015)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the placeholder DTO with only threadId, status, and createdAt, and no forbidden key", async () => {
    const result = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, readDeps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.thread).toEqual({ threadId: THREAD_ID, status: "erased", createdAt: CREATED.toISOString(), replies: [] });
    for (const key of FORBIDDEN_KEYS) {
      expect(result.thread).not.toHaveProperty(key);
    }
  });

  it("keeps other people's replies with their own tag, and keeps a tombstone at its position", async () => {
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      readDeps({
        repliesReader: repliesReader([
          activeReply("reply-old", OTHER_MEMBER_UID, "Still relevant", "2026-08-02T00:00:00Z"),
          tombstone("reply-gone", "2026-08-03T00:00:00Z"),
          activeReply("reply-new", MEMBER_UID, "Me too", "2026-08-04T00:00:00Z"),
        ]),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (!("status" in result.thread)) throw new Error("expected the erased placeholder");
    const replies = result.thread.replies;
    expect(replies.map((r) => r.replyId)).toEqual(["reply-old", "reply-gone", "reply-new"]);
    expect(replies[0]).toMatchObject({
      isDeleted: false,
      body: "Still relevant",
      authorTag: authorTag(TEAM_ID, OTHER_MEMBER_UID),
      isOwnReply: false,
    });
    expect(replies[1]).toEqual({
      replyId: "reply-gone",
      isDeleted: true,
      body: null,
      authorTag: null,
      isOwnReply: false,
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    expect(replies[2]).toMatchObject({ isOwnReply: true });
  });

  it("never decrypts the placeholder, because it has no content", async () => {
    const decryptContent = vi.fn(decryptRecord);
    await getThreadWithReplies("token", TEAM_ID, THREAD_ID, readDeps({ decryptContent }));

    expect(decryptContent).not.toHaveBeenCalled();
  });

  it("returns not_found for a placeholder that belongs to another team (identical to a missing thread)", async () => {
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      readDeps({ threadReader: threadReader(placeholder({ teamId: OTHER_TEAM_ID })) }),
    );

    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("fails closed when the placeholder carries an extra key such as a title", async () => {
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      readDeps({ threadReader: threadReader({ ...placeholder(), title: "leaked?" }) }),
    );

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("fails closed for a record with erased status plus active content, and never decrypts it", async () => {
    const encoded = encryptRecord(JSON.stringify({ title: "leak?", body: "content" }), forumThreadContext(TEAM_ID, THREAD_ID));
    const decryptContent = vi.fn(decryptRecord);
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      readDeps({
        threadReader: threadReader({
          teamId: TEAM_ID,
          authorUid: OTHER_MEMBER_UID,
          createdAt: CREATED,
          erasedAt: new Date("2026-10-01T00:00:00Z"),
          status: "erased",
          ...encoded,
        }),
        decryptContent,
      }),
    );

    expect(result).toEqual({ ok: false, error: "read_failed" });
    expect(decryptContent).not.toHaveBeenCalled();
  });

  it("fails the whole call closed when the reply read fails", async () => {
    const failing: ForumRepliesReader = { listOrderedForThread: vi.fn().mockRejectedValue(new Error("outage")) };
    const result = await getThreadWithReplies("token", TEAM_ID, THREAD_ID, readDeps({ repliesReader: failing }));

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("refuses a caller who is not a member of the team, before reading the placeholder", async () => {
    const reader = threadReader(placeholder());
    const result = await getThreadWithReplies(
      "token",
      TEAM_ID,
      THREAD_ID,
      readDeps({ verifyToken: verifyAs(OTHER_MEMBER_UID), threadReader: reader }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(reader.getThread).not.toHaveBeenCalled();
  });
});

describe("createReply against an erased-thread placeholder (TASK-015)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns not_found and writes no reply", async () => {
    const collection: ForumRepliesCollection & { writes: unknown[] } = {
      writes: [],
      reserveId: () => "generated-reply-1",
      create: vi.fn((_replyId: string, record: unknown) => {
        collection.writes.push(record);
      }),
    };
    const membershipReader: MembershipReader = {
      getMembership: vi.fn(async () => ({ uid: MEMBER_UID, teamId: TEAM_ID, createdAt: CREATED, createdVia: "admin_direct", grantedBy: "admin" })),
    };
    const teamStatusReader: TeamStatusReader = { getTeamStatus: vi.fn(async () => "active") };
    const deps: CreateReplyDeps = {
      verifyToken: verifyAs(MEMBER_UID),
      runReplyTransaction: (_uid, work) =>
        work({
          membershipReader,
          teamStatusReader,
          threadReader: { getThread: vi.fn(async () => placeholder()) },
          replyCountReader: { countRepliesForThread: vi.fn(async () => 0) },
          collection,
        }),
      now: new Date("2026-09-01T00:00:00Z"),
    };

    const result = await createReply("token", TEAM_ID, THREAD_ID, "Hello from a reader of a placeholder", deps);

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(collection.writes).toEqual([]);
  });
});

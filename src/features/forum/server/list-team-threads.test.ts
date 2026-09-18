import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EncryptedPayload } from "../../../lib/encryption/encryption";
import { decrypt, encrypt } from "../../../lib/encryption/encryption";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "../../teams/server/authorize-team-access";
import { authorTag } from "../domain/author-tag";
import * as listTeamThreadsModule from "./list-team-threads";
import { LIST_TEAM_THREADS_LIMIT } from "./list-team-threads";
import type {
  ListTeamThreadsDeps,
  RawThreadDoc,
  ThreadsReader,
} from "./list-team-threads";
import { listTeamThreads } from "./list-team-threads";

const TEAM_ID = "team-42";
const OTHER_TEAM_ID = "team-99";
const MEMBER_UID = "member-1";
const OTHER_AUTHOR_UID = "member-2";
const ADMIN_EMAIL = "admin@example.com";

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

function encryptedContent(title: string, body: string): EncryptedPayload {
  return encrypt(JSON.stringify({ title, body }));
}

function threadDoc(
  id: string,
  content: { title: string; body: string } | undefined,
  overrides: Record<string, unknown> = {},
): RawThreadDoc {
  const encoded = content !== undefined ? encryptedContent(content.title, content.body) : undefined;
  return {
    id,
    data: {
      teamId: TEAM_ID,
      authorUid: MEMBER_UID,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      ...(encoded ?? {
        ciphertext: "not-used",
        iv: "not-used",
        authTag: "not-used",
        keyVersion: "v1",
      }),
      ...overrides,
    },
  };
}

function fakeReader(
  docs: RawThreadDoc[],
  options: { ignoreTeamFilter?: boolean } = {},
): ThreadsReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listRecentForTeam(teamId) {
      calls.push(teamId);
      const scoped = options.ignoreTeamFilter
        ? docs
        : docs.filter((doc) => (doc.data as Record<string, unknown>).teamId === teamId);

      // Mirrors the real Firestore query's own `orderBy("createdAt",
      // "desc").limit(200)` shape, so a 200-row-bound test here exercises
      // the same ordering/truncation behavior a real query would apply.
      return [...scoped]
        .sort((a, b) => {
          const aDate = (a.data as Record<string, unknown>).createdAt as Date;
          const bDate = (b.data as Record<string, unknown>).createdAt as Date;
          return bDate.getTime() - aDate.getTime();
        })
        .slice(0, LIST_TEAM_THREADS_LIMIT);
    },
  };
}

function failingReader(): ThreadsReader {
  return {
    listRecentForTeam: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
  };
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

function baseDeps(overrides: Partial<ListTeamThreadsDeps> = {}): ListTeamThreadsDeps {
  return {
    verifyToken: verifyTokenReturning(memberIdentity()),
    allowList: [ADMIN_EMAIL],
    authCollection: fakeAuthCollection({
      teamStatus: { [TEAM_ID]: "active" },
      memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: { uid: MEMBER_UID, teamId: TEAM_ID } },
    }),
    reader: fakeReader([]),
    ...overrides,
  };
}

describe("listTeamThreads", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns a real member's team threads, newest-first, with authorTag/isOwnThread computed", async () => {
    const docs = [
      threadDoc("thread-old", { title: "Older thread", body: "Older body" }, {
        createdAt: new Date("2026-08-01T00:00:00Z"),
        authorUid: OTHER_AUTHOR_UID,
      }),
      threadDoc("thread-new", { title: "Newer thread", body: "Newer body" }, {
        createdAt: new Date("2026-08-02T00:00:00Z"),
        authorUid: MEMBER_UID,
      }),
    ];
    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ reader: fakeReader(docs) }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.threads.map((t) => t.threadId)).toEqual(["thread-new", "thread-old"]);

    const newest = result.threads[0];
    expect(newest.title).toBe("Newer thread");
    expect(newest.authorTag).toBe(authorTag(TEAM_ID, MEMBER_UID));
    expect(newest.isOwnThread).toBe(true);
    expect(newest.createdAt).toBe(new Date("2026-08-02T00:00:00Z").toISOString());

    const oldest = result.threads[1];
    expect(oldest.authorTag).toBe(authorTag(TEAM_ID, OTHER_AUTHOR_UID));
    expect(oldest.isOwnThread).toBe(false);
  });

  it("allows an app admin (no real membership) to list a team's threads", async () => {
    const docs = [threadDoc("thread-1", { title: "T", body: "B" })];
    const result = await listTeamThreads(
      "token",
      TEAM_ID,
      baseDeps({
        verifyToken: verifyTokenReturning(adminIdentity()),
        authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" } }),
        reader: fakeReader(docs),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.threads).toHaveLength(1);
  });

  it("rejects an unauthenticated caller and performs no listing read", async () => {
    const reader = fakeReader([threadDoc("thread-1", { title: "T", body: "B" })]);
    const verifyToken = vi.fn().mockRejectedValue(new Error("bad token"));

    const result = await listTeamThreads("bad-token", TEAM_ID, baseDeps({ verifyToken, reader }));

    expect(result).toEqual({ ok: false, error: "unauthenticated" });
    expect(reader.calls).toHaveLength(0);
  });

  it("rejects a non-member/non-admin caller (forbidden), performing no listing read", async () => {
    const reader = fakeReader([threadDoc("thread-1", { title: "T", body: "B" })]);

    const result = await listTeamThreads(
      "token",
      TEAM_ID,
      baseDeps({
        authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" } }),
        reader,
      }),
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(reader.calls).toHaveLength(0);
  });

  it("never collapses a read_failed from the authorization check itself into forbidden", async () => {
    const authCollection: AuthorizeTeamAccessCollection = {
      getTeamStatus: vi.fn().mockRejectedValue(new Error("simulated firestore outage")),
      getMembership: vi.fn(),
    };

    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ authCollection }));

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("reports read_failed, not a fabricated empty list, when the underlying query fails", async () => {
    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ reader: failingReader() }));

    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("excludes a cross-team document even if a misbehaving reader ignores its own team scoping (BR-18)", async () => {
    const crossTeamDoc = threadDoc("cross-team-thread", { title: "Leaked", body: "Leaked body" }, {
      teamId: OTHER_TEAM_ID,
    });
    const ownTeamDoc = threadDoc("own-thread", { title: "Own", body: "Own body" });
    const reader = fakeReader([crossTeamDoc, ownTeamDoc], { ignoreTeamFilter: true });

    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.threads.map((t) => t.threadId)).toEqual(["own-thread"]);
  });

  it("a caller authorized only for Team A cannot list Team B's threads via a correctly-scoped reader", async () => {
    const reader = fakeReader([threadDoc("team-b-thread", { title: "T", body: "B" }, { teamId: OTHER_TEAM_ID })]);

    const result = await listTeamThreads("token", OTHER_TEAM_ID, baseDeps({ reader }));

    // Not a member/admin of OTHER_TEAM_ID per baseDeps' authCollection.
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("excludes a malformed thread document (missing required field) without failing the whole call", async () => {
    const malformed = threadDoc("malformed-thread", undefined, { ciphertext: undefined });
    const valid = threadDoc("valid-thread", { title: "T", body: "B" });
    const reader = fakeReader([malformed, valid]);

    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.threads.map((t) => t.threadId)).toEqual(["valid-thread"]);
  });

  it("excludes a document with a wrong keyVersion literal without failing the whole call", async () => {
    const wrongVersion = threadDoc("wrong-version", { title: "T", body: "B" }, { keyVersion: "v2" });
    const valid = threadDoc("valid-thread", { title: "T", body: "B" });
    const reader = fakeReader([wrongVersion, valid]);

    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.threads.map((t) => t.threadId)).toEqual(["valid-thread"]);
  });

  it("excludes a document that fails to decrypt (tampered ciphertext) without failing the whole call", async () => {
    const tampered = threadDoc("tampered", { title: "T", body: "B" }, { ciphertext: "not-real-ciphertext==" });
    const valid = threadDoc("valid-thread", { title: "T", body: "B" });
    const reader = fakeReader([tampered, valid]);

    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ reader }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.threads.map((t) => t.threadId)).toEqual(["valid-thread"]);
  });

  it("excludes a document whose decrypted payload is not the expected {title, body} JSON shape", async () => {
    const notJson = encrypt("not json at all");
    const wrongShape = encrypt(JSON.stringify({ title: "only a title" }));
    const docs: RawThreadDoc[] = [
      { id: "not-json", data: { teamId: TEAM_ID, authorUid: MEMBER_UID, createdAt: new Date(), ...notJson } },
      { id: "wrong-shape", data: { teamId: TEAM_ID, authorUid: MEMBER_UID, createdAt: new Date(), ...wrongShape } },
      threadDoc("valid-thread", { title: "T", body: "B" }),
    ];

    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ reader: fakeReader(docs) }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.threads.map((t) => t.threadId)).toEqual(["valid-thread"]);
  });

  it("never calls decrypt for a document excluded by shape validation (decrypt-before-filter protection)", async () => {
    const malformed = threadDoc("malformed", undefined, { authorUid: undefined });
    const valid = threadDoc("valid-thread", { title: "T", body: "B" });
    const decryptSpy = spyDecrypt();

    await listTeamThreads(
      "token",
      TEAM_ID,
      baseDeps({ reader: fakeReader([malformed, valid]), decryptContent: decryptSpy }),
    );

    expect(decryptSpy.calls).toHaveLength(1);
  });

  it("enforces the 200-thread bound and returns only the 200 newest, newest-first", async () => {
    const docs: RawThreadDoc[] = [];
    for (let i = 0; i < 250; i += 1) {
      docs.push(
        threadDoc(`thread-${i}`, { title: `Title ${i}`, body: `Body ${i}` }, {
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        }),
      );
    }

    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ reader: fakeReader(docs) }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.threads).toHaveLength(200);
    expect(result.threads[0].threadId).toBe("thread-249");
    expect(result.threads[199].threadId).toBe("thread-50");

    const createdAtValues = result.threads.map((t) => new Date(t.createdAt).getTime());
    const sorted = [...createdAtValues].sort((a, b) => b - a);
    expect(createdAtValues).toEqual(sorted);
  });

  it("remains listable for a disabled team's existing members (BR-21)", async () => {
    const docs = [threadDoc("thread-1", { title: "T", body: "B" })];
    const result = await listTeamThreads(
      "token",
      TEAM_ID,
      baseDeps({
        authCollection: fakeAuthCollection({
          teamStatus: { [TEAM_ID]: "disabled" },
          memberships: { [`${MEMBER_UID}__${TEAM_ID}`]: { uid: MEMBER_UID, teamId: TEAM_ID } },
        }),
        reader: fakeReader(docs),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.threads).toHaveLength(1);
  });

  it("never returns authorUid, an encrypted field, or a value matching an email-address pattern", async () => {
    const docs = [threadDoc("thread-1", { title: "T", body: "B" }, { authorUid: "member-with-a-name" })];
    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ reader: fakeReader(docs) }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    const thread = result.threads[0];
    for (const forbiddenKey of ["authorUid", "ciphertext", "iv", "authTag", "keyVersion", "teamId"]) {
      expect(thread).not.toHaveProperty(forbiddenKey);
    }
    const serialized = JSON.stringify(result.threads);
    expect(serialized).not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    expect(serialized).not.toContain("member-with-a-name");
  });

  it("computes an identical authorTag for the same authorUid across two separate calls to the same team", async () => {
    const docs = [
      threadDoc("thread-1", { title: "First", body: "B" }, { authorUid: OTHER_AUTHOR_UID }),
    ];
    const first = await listTeamThreads("token", TEAM_ID, baseDeps({ reader: fakeReader(docs) }));
    const second = await listTeamThreads("token", TEAM_ID, baseDeps({ reader: fakeReader(docs) }));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected ok results");
    expect(first.threads[0].authorTag).toBe(second.threads[0].authorTag);
    expect(first.threads[0].authorTag).toBe(authorTag(TEAM_ID, OTHER_AUTHOR_UID));
  });

  it("never logs on success, rejection, or failure paths", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await listTeamThreads("token", TEAM_ID, baseDeps({ reader: fakeReader([threadDoc("t1", { title: "T", body: "B" })]) }));
    await listTeamThreads(
      "token",
      TEAM_ID,
      baseDeps({ authCollection: fakeAuthCollection({ teamStatus: { [TEAM_ID]: "active" } }) }),
    );
    await listTeamThreads("token", TEAM_ID, baseDeps({ reader: failingReader() }));

    const tampered = threadDoc("tampered", { title: "T", body: "B" }, { ciphertext: "not-real==" });
    await listTeamThreads("token", TEAM_ID, baseDeps({ reader: fakeReader([tampered]) }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("exposes no creation/edit-shaped export from this module", () => {
    expect(Object.keys(listTeamThreadsModule).sort()).toEqual(["LIST_TEAM_THREADS_LIMIT", "listTeamThreads"].sort());
  });

  // A hard-deleted thread simply has no document to be returned by the
  // underlying query — proven here by a reader that never includes it, since
  // there is no soft-delete/isDeleted field this operation could otherwise
  // be tempted to check. The end-to-end regression that seeds a thread via
  // the real `createThread`, deletes it via the real `deleteThread`
  // (TASK-004, not yet implemented), and re-lists is the cross-task
  // regression TASKS.md's TASK-002 entry documents as "written here but
  // exercised across TASK-002+TASK-004" — it is added once TASK-004
  // introduces `deleteThread`, not before, since importing a nonexistent
  // module here would break this task's own test suite.
  it("never fabricates a thread the reader did not return (a hard-deleted thread's absence is honored, not reconstructed)", async () => {
    const reader = fakeReader([]);

    const result = await listTeamThreads("token", TEAM_ID, baseDeps({ reader }));

    expect(result).toEqual({ ok: true, threads: [] });
  });
});

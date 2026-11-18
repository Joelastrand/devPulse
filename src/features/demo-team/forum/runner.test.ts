import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES, buildIdentityMembership } from "../identities/fixtures";
import { DEMO_FORUM_THREADS, buildForumReplyDocument, buildForumThreadDocument } from "./fixtures";
import type { ForumBatch, ForumOnlineAdapters } from "./adapters";
import { runForumProvisioning, type ForumRunnerInput } from "./runner";

const PROJECT = "demo-fake-project";
const TEAM = "8yB2bS8Jav69TCfDETON";
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
const AS_OF = new Date("2026-11-16T00:00:00.000Z");

/** In-memory store with create-only batch semantics: a batch fails whole if any document already exists. */
class FakeForumWorld {
  readonly docs = new Map<string, unknown>();
  readonly commits: string[][] = [];
  /** Runs after the plan is observed and before the batch commits (simulates a concurrent writer). */
  beforeCommit: (() => void) | null = null;

  constructor(options: { presenterTeamAdmin?: boolean; omitAuthor?: string } = {}) {
    this.docs.set(`teams/${TEAM}`, { status: "active" });
    this.docs.set(`teamMemberships/${PRESENTER}__${TEAM}`, {
      uid: PRESENTER,
      teamId: TEAM,
      role: options.presenterTeamAdmin === false ? undefined : "teamadmin",
    });
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      if (identity.uid === options.omitAuthor) continue;
      this.docs.set(`teamMemberships/${identity.uid}__${TEAM}`, buildIdentityMembership(identity, TEAM, AS_OF));
    }
  }

  adapters(): ForumOnlineAdapters {
    return {
      readDoc: async (path) => (this.docs.has(path) ? { exists: true, data: this.docs.get(path) } : { exists: false }),
      createBatch: (): ForumBatch => {
        const ops: Array<[string, unknown]> = [];
        return {
          create: (path, data) => ops.push([path, data]),
          commit: async () => {
            this.beforeCommit?.();
            if (ops.some(([path]) => this.docs.has(path))) throw new Error("already exists");
            for (const [path, data] of ops) this.docs.set(path, data);
            this.commits.push(ops.map(([path]) => path));
          },
        };
      },
    };
  }
}

function input(world: FakeForumWorld, extra: string[] = [], overrides: Partial<ForumRunnerInput> = {}): ForumRunnerInput {
  return {
    argv: ["--project", PROJECT, "--presenter-uid", PRESENTER, "--team-id", TEAM, "--as-of", "2026-11-16", ...extra],
    env: {
      FIREBASE_PROJECT_ID: PROJECT,
      FIREBASE_CLIENT_EMAIL: `seed@${PROJECT}.iam.gserviceaccount.com`,
      FIREBASE_PRIVATE_KEY: "not-a-real-key",
    },
    now: () => AS_OF,
    crypto: demoCrypto,
    createOnlineAdapters: async () => world.adapters(),
    ...overrides,
  };
}

const WRITE = ["--write", `--confirm=${PROJECT}`];
const TOTAL_DOCS = DEMO_FORUM_THREADS.length + DEMO_FORUM_THREADS.reduce((sum, t) => sum + t.replies.length, 0);

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY));
afterEach(() => vi.unstubAllEnvs());

describe("runForumProvisioning", () => {
  it("validates offline without building adapters or reading anything", async () => {
    const world = new FakeForumWorld();
    const createOnlineAdapters = vi.fn(async () => world.adapters());
    const result = await runForumProvisioning(input(world, ["--offline"], { createOnlineAdapters }));
    expect(result.exitCode).toBe(0);
    expect(createOnlineAdapters).not.toHaveBeenCalled();
    expect(result.stdout.join("\n")).toContain("fixtures valid");
  });

  it("reports the plan in a live dry run and writes nothing", async () => {
    const world = new FakeForumWorld();
    const before = world.docs.size;
    const result = await runForumProvisioning(input(world));
    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toContain(`forumThreads: create ${DEMO_FORUM_THREADS.length}, skip 0, conflict 0`);
    expect(result.stdout.join("\n")).toContain("Dry run: nothing written.");
    expect(world.docs.size).toBe(before);
    expect(world.commits).toEqual([]);
  });

  it("refuses a write without the matching confirmation before any adapter is built", async () => {
    const world = new FakeForumWorld();
    const createOnlineAdapters = vi.fn(async () => world.adapters());
    const result = await runForumProvisioning(input(world, ["--write"], { createOnlineAdapters }));
    expect(result.exitCode).toBe(2);
    expect(createOnlineAdapters).not.toHaveBeenCalled();
  });

  it("creates every thread and reply in one batch on a confirmed write, sealed and attributed", async () => {
    const world = new FakeForumWorld();
    const result = await runForumProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(0);
    expect(world.commits).toHaveLength(1);
    expect(world.commits[0]).toHaveLength(TOTAL_DOCS);
    const stored = JSON.stringify([...world.docs.entries()].filter(([path]) => path.startsWith("forum")));
    for (const thread of DEMO_FORUM_THREADS) expect(stored).not.toContain(thread.title);
    expect(world.docs.get("forumThreads/demo-thread-01")).toMatchObject({
      teamId: TEAM,
      authorUid: DEMO_FORUM_THREADS[0].authorUid,
    });
    expect(result.stdout.join("\n")).toContain("Updates: 0. Deletes: 0");
  });

  it("is a no-op on rerun once every record matches, leaving the stored ciphertext untouched", async () => {
    const world = new FakeForumWorld();
    await runForumProvisioning(input(world, WRITE));
    const snapshot = new Map(world.docs);
    const rerun = await runForumProvisioning(input(world, WRITE));
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout.join("\n")).toContain("nothing to write");
    expect(world.commits).toHaveLength(1);
    expect(world.docs).toEqual(snapshot);
  });

  it("creates only the missing records after a partial earlier run and skips the exact matches", async () => {
    const world = new FakeForumWorld();
    const first = DEMO_FORUM_THREADS[0];
    world.docs.set(`forumThreads/${first.threadId}`, buildForumThreadDocument(first, TEAM, demoCrypto.sealRecord));
    const result = await runForumProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(0);
    expect(world.commits[0]).toHaveLength(TOTAL_DOCS - 1);
    expect(result.stdout.join("\n")).toContain(`forumThreads: create ${DEMO_FORUM_THREADS.length - 1}, skip 1, conflict 0`);
  });

  it("stops on an existing thread whose content differs, writing nothing", async () => {
    const world = new FakeForumWorld();
    const first = DEMO_FORUM_THREADS[0];
    const different = { ...first, body: "En annen tekst enn fixturen." };
    world.docs.set(`forumThreads/${first.threadId}`, buildForumThreadDocument(different, TEAM, demoCrypto.sealRecord));
    const result = await runForumProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stdout.join("\n")).toContain("Conflict: forumThreads/demo-thread-01 (content-differs)");
    expect(world.commits).toEqual([]);
  });

  it("treats an undecryptable existing reply as a conflict and writes nothing", async () => {
    const world = new FakeForumWorld();
    const thread = DEMO_FORUM_THREADS[0];
    const reply = thread.replies[0];
    const doc = buildForumReplyDocument(reply, thread, TEAM, demoCrypto.sealRecord);
    world.docs.set(`forumReplies/${reply.replyId}`, { ...doc, ciphertext: "AAAA" });
    const result = await runForumProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stdout.join("\n")).toContain(`Conflict: forumReplies/${reply.replyId} (undecryptable)`);
    expect(world.commits).toEqual([]);
  });

  it("refuses when a fixture author has no live membership of the team", async () => {
    const world = new FakeForumWorld({ omitAuthor: "demo-member-03" });
    const result = await runForumProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("author-membership-missing");
    expect(world.commits).toEqual([]);
  });

  it("refuses when the presenter is not the team's teamadmin", async () => {
    const world = new FakeForumWorld({ presenterTeamAdmin: false });
    const result = await runForumProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("presenter-not-teamadmin");
    expect(world.commits).toEqual([]);
  });

  it("fails closed when another writer creates a fixture thread between observation and commit", async () => {
    const world = new FakeForumWorld();
    const racing = DEMO_FORUM_THREADS[4];
    world.beforeCommit = () => {
      world.docs.set(`forumThreads/${racing.threadId}`, { raced: true });
    };
    const result = await runForumProvisioning(input(world, WRITE));
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("forum-write-failed");
    expect(world.commits).toEqual([]);
    expect(world.docs.get(`forumThreads/${racing.threadId}`)).toEqual({ raced: true });
    expect(world.docs.has(`forumThreads/${DEMO_FORUM_THREADS[0].threadId}`)).toBe(false);
  });
});

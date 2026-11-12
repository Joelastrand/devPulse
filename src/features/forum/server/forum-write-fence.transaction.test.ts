import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { membershipDocId } from "../../teams/domain/team-membership";
import { createThread } from "./create-thread";
import { deleteReply } from "./delete-reply";
import { deleteThread } from "./delete-thread";

// TASK-029: production forum write transactions over a recording Admin Firestore double. These are structural tests: the erasure
// fence is read first, inside the same transaction as the write; a refusal writes nothing; a retried attempt commits its writes
// only once. They do not model Firestore's conflict behaviour (that is the manual D-EMU gate). Fixtures are synthetic.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const TEAM_ID = "team-42";
const THREAD_ID = "thread-1";
const REPLY_ID = "reply-1";
const ACTOR = "actor-1";
const AUTHOR = "author-1";

type Data = Record<string, unknown>;

interface Double {
  db: unknown;
  log: string[];
  docs: Map<string, Data>;
  /** Writes of the committed attempts only, as `op path`. */
  committed: string[];
  abortAttempts: number;
}

/**
 * A recording double. `preRead` overrides what a plain pre-read sees, so a test can make the pre-read and the in-transaction
 * read disagree (a concurrent change between them). Create paths never call a plain read; delete paths do, to read the
 * target's own facts before their fenced write, which re-reads the document inside the transaction.
 */
function createDouble(seed: Record<string, Data>, preRead: Record<string, Data> = {}): Double {
  const double: Double = { db: undefined, log: [], docs: new Map(Object.entries(seed)), committed: [], abortAttempts: 0 };
  let autoId = 0;

  const docRef = (path: string) => ({
    path,
    id: path.split("/").at(-1) as string,
    async get() {
      double.log.push(`get|${path}`);
      const seen = preRead[path] ?? double.docs.get(path);
      return { exists: seen !== undefined, data: () => seen };
    },
  });

  const queryOf = (collection: string, filters: Array<[string, string]>, bound?: number) => ({
    kind: "query" as const,
    collection,
    filters,
    bound,
    where: (field: string, _op: string, value: string) => queryOf(collection, [...filters, [field, value]], bound),
    limit: (n: number) => queryOf(collection, filters, n),
    count: () => ({ kind: "count" as const, collection, filters }),
  });

  const matchingPaths = (collection: string, filters: Array<[string, string]>) =>
    [...double.docs.keys()].filter((path) => {
      if (!path.startsWith(`${collection}/`)) return false;
      const data = double.docs.get(path) ?? {};
      return filters.every(([field, value]) => data[field] === value);
    });

  double.db = {
    collection: (name: string) => ({
      doc: (id?: string) => docRef(`${name}/${id ?? `auto${String((autoId += 1)).padStart(10, "0")}`}`),
      where: (field: string, _op: string, value: string) => queryOf(name, [[field, value]]),
    }),
    async runTransaction(work: (tx: unknown) => Promise<unknown>) {
      double.log.push("runTransaction");
      for (;;) {
        const pending: string[] = [];
        const writes: Array<() => void> = [];
        const tx = {
          async get(target: { path?: string; kind?: string; collection?: string; filters?: Array<[string, string]>; bound?: number }) {
            if (target.kind === "query") {
              const paths = matchingPaths(target.collection as string, target.filters as Array<[string, string]>).slice(0, target.bound);
              double.log.push(`tx.query|${target.collection}`);
              return {
                empty: paths.length === 0,
                size: paths.length,
                docs: paths.map((path) => ({ ref: docRef(path) })),
              };
            }
            if (target.kind === "count") {
              double.log.push(`tx.count|${target.collection}`);
              return { data: () => ({ count: matchingPaths(target.collection as string, target.filters as Array<[string, string]>).length }) };
            }
            const path = target.path as string;
            double.log.push(`tx.get|${path}`);
            return { exists: double.docs.has(path), data: () => double.docs.get(path) };
          },
          create(ref: { path: string }, data: Data) {
            double.log.push(`tx.create|${ref.path}`);
            pending.push(`create ${ref.path}`);
            writes.push(() => double.docs.set(ref.path, data));
          },
          update(ref: { path: string }, data: Data) {
            double.log.push(`tx.update|${ref.path}`);
            pending.push(`update ${ref.path}`);
            writes.push(() => double.docs.set(ref.path, { ...(double.docs.get(ref.path) ?? {}), ...data }));
          },
          delete(ref: { path: string }) {
            double.log.push(`tx.delete|${ref.path}`);
            pending.push(`delete ${ref.path}`);
            writes.push(() => double.docs.delete(ref.path));
          },
        };
        const result = await work(tx);
        if (double.abortAttempts > 0) {
          double.abortAttempts -= 1;
          continue;
        }
        writes.forEach((apply) => apply());
        double.committed.push(...pending);
        return result;
      }
    },
  };
  return double;
}

/** The recorded log split into transactions: each transaction's entries begin after a `runTransaction` entry. */
function transactionsOf(log: string[]): string[][] {
  const transactions: string[][] = [];
  for (const entry of log) {
    if (entry === "runTransaction") transactions.push([]);
    else transactions.at(-1)?.push(entry);
  }
  return transactions;
}

const membership = `teamMemberships/${membershipDocId(ACTOR, TEAM_ID)}`;
const fence = `accountErasures/${ACTOR}`;
const team = `teams/${TEAM_ID}`;
const thread = `forumThreads/${THREAD_ID}`;
const reply = `forumReplies/${REPLY_ID}`;

function threadDoc(): Data {
  return {
    teamId: TEAM_ID,
    authorUid: AUTHOR,
    ciphertext: "not-used",
    iv: "not-used",
    authTag: "not-used",
    keyVersion: "v2",
    keyId: "k1",
    createdAt: new Date("2026-08-15T00:00:00Z"),
  };
}

function replyDoc(overrides: Data = {}): Data {
  return {
    teamId: TEAM_ID,
    threadId: THREAD_ID,
    authorUid: AUTHOR,
    ciphertext: "not-used",
    iv: "not-used",
    authTag: "not-used",
    keyVersion: "v2",
    keyId: "k1",
    createdAt: new Date("2026-08-16T00:00:00Z"),
    ...overrides,
  };
}

function verifyActor() {
  return vi.fn().mockResolvedValue({ uid: ACTOR, email: "admin@example.com", email_verified: true });
}

/** Admin allow-list for the actor, so the actor may delete any thread or reply in the tests. */
const isSuperadmin = async (uid: string): Promise<boolean> => uid === ACTOR;

describe("forum write transactions (TASK-029, BR-4(b))", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("create-thread", () => {
    const baseSeed = (): Record<string, Data> => ({
      [membership]: { uid: ACTOR, teamId: TEAM_ID, createdAt: new Date("2026-08-01T00:00:00Z"), createdVia: "admin_direct", grantedBy: "admin" },
      [team]: { status: "active" },
    });

    it("creates the thread in one transaction, reading the fence first, and returns the committed id", async () => {
      const double = createDouble(baseSeed());
      holder.db = double.db;

      const result = await createThread("token", TEAM_ID, "Synthetic title", "Synthetic body", { verifyToken: verifyActor() });

      expect(result.ok).toBe(true);
      expect(double.log[1]).toBe(`tx.get|${fence}`);
      expect(double.committed).toHaveLength(1);
      expect(double.committed[0]).toMatch(/^create forumThreads\//);
      expect(double.log.filter((entry) => entry.startsWith("get|"))).toEqual([]);
    });

    it("refuses with erasure_in_progress and creates nothing when the actor's erasure record exists", async () => {
      const double = createDouble({ ...baseSeed(), [fence]: { status: "in_progress" } });
      holder.db = double.db;

      expect(await createThread("token", TEAM_ID, "Synthetic title", "Synthetic body", { verifyToken: verifyActor() })).toEqual({
        ok: false,
        error: "erasure_in_progress",
      });
      expect(double.committed).toEqual([]);
    });
  });

  describe("delete-thread", () => {
    it("reads the actor's fence first, then deletes the thread and each reply batch in its own transaction", async () => {
      const double = createDouble({
        [thread]: threadDoc(),
        [reply]: replyDoc(),
      });
      holder.db = double.db;

      const result = await deleteThread("token", TEAM_ID, THREAD_ID, {
        verifyToken: verifyActor(),
        isSuperadmin,
      });

      expect(result).toEqual({ ok: true });
      // Every transaction that deletes must read the actor's fence before its first delete (per transaction, not in total).
      const writing = transactionsOf(double.log).filter((entries) => entries.some((entry) => entry.startsWith("tx.delete|")));
      expect(writing.length).toBeGreaterThanOrEqual(2);
      for (const entries of writing) {
        expect(entries[0]).toBe(`tx.get|${fence}`);
      }
      expect(double.committed).toEqual(expect.arrayContaining([`delete ${thread}`, `delete ${reply}`]));
    });

    it("refuses with erasure_in_progress and deletes nothing when the actor's erasure record exists", async () => {
      const double = createDouble({ [thread]: threadDoc(), [reply]: replyDoc(), [fence]: { status: "in_progress" } });
      holder.db = double.db;

      expect(await deleteThread("token", TEAM_ID, THREAD_ID, { verifyToken: verifyActor(), isSuperadmin })).toEqual({
        ok: false,
        error: "erasure_in_progress",
      });
      expect(double.committed).toEqual([]);
      expect(double.docs.has(thread)).toBe(true);
      expect(double.docs.has(reply)).toBe(true);
    });
  });

  describe("delete-reply (tombstone)", () => {
    it("tombstones an active reply in one transaction, fence first, re-reading the reply before the write", async () => {
      const double = createDouble({ [reply]: replyDoc() });
      holder.db = double.db;

      const result = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, {
        verifyToken: verifyActor(),
        isSuperadmin,
        now: new Date("2026-09-01T00:00:00Z"),
      });

      expect(result).toEqual({ ok: true });
      expect(double.log.indexOf(`tx.get|${fence}`)).toBeLessThan(double.log.indexOf(`tx.update|${reply}`));
      expect(double.committed).toEqual([`update ${reply}`]);
    });

    it("refuses with erasure_in_progress and leaves the reply intact when the actor's erasure record exists", async () => {
      const double = createDouble({ [reply]: replyDoc(), [fence]: { status: "in_progress" } });
      holder.db = double.db;

      expect(await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, { verifyToken: verifyActor(), isSuperadmin })).toEqual({
        ok: false,
        error: "erasure_in_progress",
      });
      expect(double.committed).toEqual([]);
      expect(double.docs.get(reply)?.ciphertext).toBe("not-used");
    });

    it("a reply tombstoned by a concurrent deleter is not overwritten with a second deletedAt or deletedBy", async () => {
      const tombstoned: Data = {
        teamId: TEAM_ID,
        threadId: THREAD_ID,
        createdAt: new Date("2026-08-16T00:00:00Z"),
        deletedAt: new Date("2026-08-30T00:00:00Z"),
        deletedBy: "first-deleter",
      };
      // The pre-read sees an active reply; the first deleter's tombstone is in place when the transaction reads it.
      const double = createDouble({ [reply]: tombstoned }, { [reply]: replyDoc() });
      holder.db = double.db;

      const result = await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, { verifyToken: verifyActor(), isSuperadmin });

      expect(result).toEqual({ ok: true });
      expect(double.log).toContain(`tx.get|${reply}`);
      expect(double.committed).toEqual([]);
      expect(double.docs.get(reply)?.deletedBy).toBe("first-deleter");
    });

    it("a retried tombstone attempt commits its update only once", async () => {
      const double = createDouble({ [reply]: replyDoc() });
      double.abortAttempts = 1;
      holder.db = double.db;

      expect(await deleteReply("token", TEAM_ID, THREAD_ID, REPLY_ID, { verifyToken: verifyActor(), isSuperadmin })).toEqual({
        ok: true,
      });
      expect(double.committed).toEqual([`update ${reply}`]);
    });
  });
});

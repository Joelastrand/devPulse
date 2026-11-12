import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { membershipDocId } from "../../teams/domain/team-membership";
import { createReply } from "./create-reply";
import { ErasureWriteRefused } from "../../auth/server/erasure-write-fence";

// TASK-029: the production create-reply transaction. These are structural tests over a recording Admin Firestore double. They
// prove the erasure fence read is the first operation in the SAME transaction as the reply create, that no plain read is
// used, and that a refusal or a retry commits no more than one reply. They do not model Firestore's conflict behaviour: that
// is the manual D-EMU gate. Fixtures are synthetic.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => holder.db,
}));
vi.mock("server-only", () => ({}));

const TEAM_ID = "team-42";
const THREAD_ID = "thread-1";
const UID = "member-1";
const BODY = "Synthetic reply body for the transaction test";

type Data = Record<string, unknown>;

interface Double {
  db: unknown;
  /** Every transactional operation, in order: `tx.get|path`, `tx.create|path`, `get|path` (plain, must stay empty). */
  log: string[];
  /** The paths of committed creates, one entry per committed reply. */
  committed: string[];
  /** Fails the next N attempts after `work` returns, as a Firestore retry would, discarding that attempt's writes. */
  abortAttempts: number;
  /** When set, the fence read throws, as a read failure would. */
  failFenceRead: boolean;
}

/** A recording double. `docs` maps a full document path to its data; a path present in `docs` exists. */
function createDouble(docs: Record<string, Data | string>): Double {
  const double: Double = { db: undefined, log: [], committed: [], abortAttempts: 0, failFenceRead: false };
  const store = new Map<string, unknown>(Object.entries(docs));
  let autoId = 0;

  const docRef = (path: string) => ({
    path,
    id: path.split("/").at(-1),
    async get() {
      double.log.push(`get|${path}`);
      throw new Error("a plain document read must not be used by create-reply");
    },
  });

  const query = (collection: string, filters: string[]) => ({
    where: (field: string, _op: string, value: string) => query(collection, [...filters, `${field}==${value}`]),
    count: () => ({ kind: "count" as const, path: `${collection}?${filters.join("&")}` }),
  });

  const snapshotOf = (path: string) => ({
    exists: store.has(path),
    id: path.split("/").at(-1),
    data: () => store.get(path) as Data | undefined,
  });

  const runAttempt = async (work: (tx: unknown) => Promise<unknown>) => {
    const pending: string[] = [];
    const tx = {
      async get(target: { path?: string; kind?: string; path_?: string } | { kind: "count"; path: string }) {
        if ("kind" in target && target.kind === "count") {
          double.log.push(`tx.get|count|${target.path}`);
          const matching = [...store.keys()].filter((p) => p.startsWith("forumReplies/")).length;
          return { data: () => ({ count: matching }) };
        }
        const path = (target as { path: string }).path;
        if (path === undefined) throw new Error("unexpected transactional read target");
        double.log.push(`tx.get|${path}`);
        if (path.startsWith("accountErasures/") && double.failFenceRead) throw new Error("firestore unavailable");
        return snapshotOf(path);
      },
      create(ref: { path: string }, data: Data) {
        double.log.push(`tx.create|${ref.path}`);
        pending.push(ref.path);
        store.set(ref.path, data);
      },
    };
    const result = await work(tx);
    return { result, pending };
  };

  double.db = {
    collection: (name: string) => ({
      doc: (id?: string) => {
        const resolved = id ?? `auto${String((autoId += 1)).padStart(12, "0")}`;
        return docRef(`${name}/${resolved}`);
      },
      where: (field: string, op: string, value: string) => query(name, [`${field}==${value}`]),
    }),
    async runTransaction(work: (tx: unknown) => Promise<unknown>) {
      double.log.push("runTransaction");
      let attempts = 0;
      for (;;) {
        attempts += 1;
        const attempt = await runAttempt(work);
        if (double.abortAttempts > 0) {
          double.abortAttempts -= 1;
          // A retried attempt: its buffered writes are discarded, exactly as Firestore discards an aborted attempt.
          for (const path of attempt.pending) store.delete(path);
          continue;
        }
        for (const path of attempt.pending) double.committed.push(path);
        return attempt.result;
      }
    },
  };
  return double;
}

const membershipPath = `teamMemberships/${membershipDocId(UID, TEAM_ID)}`;
const threadPath = `forumThreads/${THREAD_ID}`;
const teamPath = `teams/${TEAM_ID}`;
const fencePath = `accountErasures/${UID}`;

function validThread(): Data {
  return {
    teamId: TEAM_ID,
    authorUid: "thread-author",
    ciphertext: "not-used",
    iv: "not-used",
    authTag: "not-used",
    keyVersion: "v2",
    keyId: "k1",
    createdAt: new Date("2026-08-15T00:00:00Z"),
  };
}

function baseDocs(overrides: Record<string, Data | string> = {}): Record<string, Data | string> {
  return {
    [membershipPath]: { uid: UID, teamId: TEAM_ID, createdAt: new Date("2026-08-01T00:00:00Z"), createdVia: "admin_direct", grantedBy: "admin" },
    [teamPath]: { status: "active" },
    [threadPath]: validThread(),
    ...overrides,
  };
}

function verifyToken() {
  return vi.fn().mockResolvedValue({ uid: UID, email: "dev@example.com", email_verified: true });
}

describe("create-reply production transaction (TASK-029)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates the reply in one transaction when no erasure record exists", async () => {
    const double = createDouble(baseDocs());
    holder.db = double.db;

    const result = await createReply("token", TEAM_ID, THREAD_ID, BODY, { verifyToken: verifyToken(), now: new Date("2026-09-01T00:00:00Z") });

    expect(result).toEqual({ ok: true });
    expect(double.committed).toHaveLength(1);
    expect(double.committed[0]).toMatch(/^forumReplies\//);
  });

  it("reads the erasure fence first, through the same transaction that performs the create (BR-4(b))", async () => {
    const double = createDouble(baseDocs());
    holder.db = double.db;

    await createReply("token", TEAM_ID, THREAD_ID, BODY, { verifyToken: verifyToken() });

    expect(double.log[0]).toBe("runTransaction");
    expect(double.log[1]).toBe(`tx.get|${fencePath}`);
    const createAt = double.log.findIndex((entry) => entry.startsWith("tx.create|forumReplies/"));
    expect(createAt).toBeGreaterThan(1);
    expect(double.log.filter((entry) => entry.startsWith("tx.get|"))).toContain(`tx.get|${fencePath}`);
  });

  it("performs every read inside the transaction; no plain document read happens (fake-independent structure)", async () => {
    const double = createDouble(baseDocs());
    holder.db = double.db;

    await createReply("token", TEAM_ID, THREAD_ID, BODY, { verifyToken: verifyToken() });

    expect(double.log.filter((entry) => entry.startsWith("get|"))).toEqual([]);
  });

  it("refuses with erasure_in_progress when a valid erasure record exists, and writes no reply", async () => {
    const double = createDouble(baseDocs({ [fencePath]: { status: "in_progress" } }));
    holder.db = double.db;

    const result = await createReply("token", TEAM_ID, THREAD_ID, BODY, { verifyToken: verifyToken() });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(double.committed).toEqual([]);
    expect(double.log.some((entry) => entry.startsWith("tx.create|"))).toBe(false);
  });

  it("refuses with erasure_in_progress when the erasure record is malformed (fail closed), and writes no reply", async () => {
    const double = createDouble(baseDocs({ [fencePath]: { status: 7, unexpected: true } }));
    holder.db = double.db;

    const result = await createReply("token", TEAM_ID, THREAD_ID, BODY, { verifyToken: verifyToken() });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect(double.committed).toEqual([]);
  });

  it("a failed fence read aborts the protected write: persistence_failed, no create, no later read", async () => {
    const double = createDouble(baseDocs());
    double.failFenceRead = true;
    holder.db = double.db;

    const result = await createReply("token", TEAM_ID, THREAD_ID, BODY, { verifyToken: verifyToken() });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(double.committed).toEqual([]);
    expect(double.log.filter((entry) => entry.startsWith("tx.get|") && entry !== `tx.get|${fencePath}`)).toEqual([]);
  });

  it("a caller with no membership is forbidden inside the transaction, and no reply is written (BR-1 unchanged)", async () => {
    const docs = baseDocs();
    delete docs[membershipPath];
    const double = createDouble(docs);
    holder.db = double.db;

    expect(await createReply("token", TEAM_ID, THREAD_ID, BODY, { verifyToken: verifyToken() })).toEqual({ ok: false, error: "forbidden" });
    expect(double.committed).toEqual([]);
  });

  it("a disabled team is refused inside the transaction (BR-7 unchanged)", async () => {
    const double = createDouble(baseDocs({ [teamPath]: { status: "disabled" } }));
    holder.db = double.db;

    expect(await createReply("token", TEAM_ID, THREAD_ID, BODY, { verifyToken: verifyToken() })).toEqual({ ok: false, error: "team_disabled" });
    expect(double.committed).toEqual([]);
  });

  it("an erased-thread placeholder refuses replies as not_found (TASK-015 unchanged)", async () => {
    const double = createDouble(baseDocs({ [threadPath]: { status: "erased", createdAt: new Date("2026-08-15T00:00:00Z") } }));
    holder.db = double.db;

    expect(await createReply("token", TEAM_ID, THREAD_ID, BODY, { verifyToken: verifyToken() })).toEqual({ ok: false, error: "not_found" });
    expect(double.committed).toEqual([]);
  });

  it("a retried transaction attempt commits at most one reply (the callback has no external effect)", async () => {
    const double = createDouble(baseDocs());
    double.abortAttempts = 1;
    holder.db = double.db;

    const result = await createReply("token", TEAM_ID, THREAD_ID, BODY, { verifyToken: verifyToken() });

    expect(result).toEqual({ ok: true });
    expect(double.committed).toHaveLength(1);
  });

  it("maps a fence refusal thrown by the transaction to erasure_in_progress through the outer mapping", async () => {
    const result = await createReply("token", TEAM_ID, THREAD_ID, BODY, {
      verifyToken: verifyToken(),
      runReplyTransaction: async () => {
        throw new ErasureWriteRefused();
      },
    });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
  });

  it("maps any other transaction failure to persistence_failed, without the raw error", async () => {
    const result = await createReply("token", TEAM_ID, THREAD_ID, BODY, {
      verifyToken: verifyToken(),
      runReplyTransaction: async () => {
        throw new Error("firestore internal detail");
      },
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
  });
});

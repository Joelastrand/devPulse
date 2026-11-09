import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { ErasureWriteRefused, runFencedTransaction } from "./erasure-write-fence";
import { createForumPort } from "../../account-erasure/server/erasure-adapters-forum";
import { runForumBatch } from "../../account-erasure/server/forum-erasure";

/**
 * D-EMU: erasure fence ordering against the REAL local Firestore Emulator (TASK-004, SPEC decision D-EMU).
 *
 * Runs only when `FIRESTORE_EMULATOR_HOST` is set and `DEVPULSE_EMULATOR_PROJECT` is a `demo-` project id. It never reads
 * real credentials and never reaches a non-emulator host. Skipped otherwise.
 *
 * Owner decision (2026-11-08): Firestore transaction ordering is serializable. A protected write may commit before the fence,
 * provided the erasure sweep later removes it. The properties under test are:
 * 1. a protected write committed before the fence is removed by the sweep;
 * 2. a protected write attempted after the fence is established is refused and writes nothing;
 * 3. a concurrent protected write and fence creation, in either serial order, leave no protected reply after the sweep;
 * 4. a sweep that has not finished is never reported as done.
 *
 * Synchronisation: no test awaits a competing write from inside a transaction callback. The emulator's transaction lock makes
 * that wait forever (the callback waits for the write, the write waits for the transaction). Competing writes are started
 * outside the callback and awaited only after the transaction settles.
 */

// Real emulator round trips are slow on this machine; the default 5s/10s budgets are too tight for seeded transactions.
if (process.env.FIRESTORE_EMULATOR_HOST) vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.DEVPULSE_EMULATOR_PROJECT;
const CONFIGURED = typeof EMULATOR_HOST === "string" && EMULATOR_HOST.length > 0 && typeof PROJECT_ID === "string" && PROJECT_ID.startsWith("demo-");

const APP_NAME = "erasure-fence-race-emulator";
const UID = "uid-race-emulator";
const OTHER_UID = "uid-race-emulator-other";
const TEAM_ID = "team-race-emulator";
const THREAD_ID = "thread-race-emulator";

const db = vi.hoisted(() => ({ current: undefined as Firestore | undefined }));

// The production forum adapter reads the database through `getFirestoreDb`. Only that accessor is routed to the emulator.
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => {
    if (db.current === undefined) throw new Error("emulator database not initialised");
    return db.current;
  },
  getAdminAuth: () => {
    throw new Error("auth is not used by the emulator suite");
  },
}));

/** A well-formed active reply (BR-56 active shape). Synthetic ciphertext only. */
function activeReply(authorUid: string) {
  return {
    teamId: TEAM_ID,
    threadId: THREAD_ID,
    authorUid,
    ciphertext: "c3ludGhldGlj",
    iv: "aXY=",
    authTag: "dGFn",
    keyVersion: "v1",
    createdAt: new Date("2026-11-01T10:00:00Z"),
  };
}

const replyRef = (db: Firestore, id: string) => db.collection("forumReplies").doc(id);
const fenceRef = (db: Firestore, uid: string) => db.collection("accountErasures").doc(uid);

/** Removes everything this suite writes for the given uids, so each test starts from an empty state. */
async function resetFor(database: Firestore, uids: readonly string[], replyIds: readonly string[]): Promise<void> {
  await Promise.all([...uids.map((uid) => fenceRef(database, uid).delete()), ...replyIds.map((id) => replyRef(database, id).delete())]);
}

/** Runs the production forum erasure step to completion, with a small batch budget. Fails if it never reports done. */
async function sweepForumToCompletion(uid: string, maxWrites = 2): Promise<void> {
  const deps = { port: createForumPort(), now: () => new Date("2026-11-08T12:00:00Z") };
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await runForumBatch(deps, uid, maxWrites);
    if (result === "done") return;
  }
  throw new Error("forum sweep did not reach done");
}

describe.skipIf(!CONFIGURED)("D-EMU: erasure fence ordering on the real Firestore Emulator", () => {
  let app: App | undefined;
  let database: Firestore;
  const replyIds = [
    "race-before-fence",
    "race-after-fence",
    "race-concurrent",
    "race-other-1",
    "race-other-2",
  ].map((suffix) => `${suffix}-${UID}`);

  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID as string }, APP_NAME);
    database = getFirestore(app);
    db.current = database;
  });

  beforeEach(async () => {
    await resetFor(database, [UID, OTHER_UID], [...replyIds, `race-other-${OTHER_UID}`]);
  });

  afterAll(async () => {
    await resetFor(database, [UID, OTHER_UID], [...replyIds, `race-other-${OTHER_UID}`]);
    db.current = undefined;
    if (app !== undefined) await deleteApp(app);
  });

  it("1. a write committed before the fence is tombstoned by the sweep and leaves no authored data", async () => {
    // The fence is absent, so this protected write commits.
    await runFencedTransaction(database, UID, async (tx) => {
      tx.create(replyRef(database, replyIds[0]), activeReply(UID));
    });
    expect((await replyRef(database, replyIds[0]).get()).exists).toBe(true);

    await fenceRef(database, UID).create({ status: "in_progress", step: "forum" });
    await sweepForumToCompletion(UID);

    const swept = (await replyRef(database, replyIds[0]).get()).data();
    expect(swept?.authorUid).toBeUndefined();
    expect(swept?.ciphertext).toBeUndefined();
    expect(swept?.deletedBy).toBe("erased");
  });

  it("2. a write attempted after the fence is established is refused and writes nothing", async () => {
    await fenceRef(database, UID).create({ status: "in_progress", step: "forum" });

    await expect(
      runFencedTransaction(database, UID, async (tx) => {
        tx.create(replyRef(database, replyIds[1]), activeReply(UID));
      }),
    ).rejects.toBeInstanceOf(ErasureWriteRefused);

    expect((await replyRef(database, replyIds[1]).get()).exists).toBe(false);
  });

  it("3. a concurrent protected write and fence creation leave no protected reply once the sweep completes", async () => {
    // Both operations run concurrently and neither is awaited inside a transaction callback. Serializability allows either
    // order: the write is refused, or it commits before the fence and the sweep must remove it.
    const [write, fence] = await Promise.allSettled([
      runFencedTransaction(database, UID, async (tx) => {
        tx.create(replyRef(database, replyIds[2]), activeReply(UID));
      }),
      fenceRef(database, UID).create({ status: "in_progress", step: "forum" }),
    ]);

    expect(fence.status).toBe("fulfilled");
    if (write.status === "rejected") {
      expect(write.reason).toBeInstanceOf(ErasureWriteRefused);
    }

    await sweepForumToCompletion(UID);

    const survivor = (await replyRef(database, replyIds[2]).get()).data();
    expect(survivor?.authorUid).toBeUndefined();
    expect(survivor?.ciphertext).toBeUndefined();
  });

  it("4. a sweep that has not finished is never reported as done", async () => {
    await runFencedTransaction(database, UID, async (tx) => {
      tx.create(replyRef(database, replyIds[3]), activeReply(UID));
    });
    await runFencedTransaction(database, UID, async (tx) => {
      tx.create(replyRef(database, replyIds[4]), activeReply(UID));
    });
    await fenceRef(database, UID).create({ status: "in_progress", step: "forum" });

    // One write per batch, two authored replies: the first batch must report more work, not done.
    const deps = { port: createForumPort(), now: () => new Date("2026-11-08T12:00:00Z") };
    expect(await runForumBatch(deps, UID, 1)).toBe("more");
    const authoredLeft = (await database.collection("forumReplies").where("authorUid", "==", UID).get()).size;
    expect(authoredLeft).toBe(1);
  });

  it("does not touch another uid's protected replies during the sweep", async () => {
    const otherReply = `race-other-${OTHER_UID}`;
    await runFencedTransaction(database, OTHER_UID, async (tx) => {
      tx.create(replyRef(database, otherReply), activeReply(OTHER_UID));
    });
    await fenceRef(database, UID).create({ status: "in_progress", step: "forum" });
    await sweepForumToCompletion(UID);

    expect((await replyRef(database, otherReply).get()).data()?.authorUid).toBe(OTHER_UID);
  });
});

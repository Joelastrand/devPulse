import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { ErasureWriteRefused, runFencedTransaction } from "./erasure-write-fence";

/**
 * D-EMU: the Firestore commit-ordering race proof against the REAL local Firestore Emulator (TASK-004, SPEC decision D-EMU).
 *
 * This is not an in-memory approximation. It runs only when all of these hold, and it is skipped otherwise:
 * - `FIRESTORE_EMULATOR_HOST` is set (a local emulator, for example `127.0.0.1:8080`);
 * - `DEVPULSE_EMULATOR_PROJECT` is set to a demo project id beginning with `demo-` (the emulator's convention, and never a
 *   real project). The test never reads real credentials and never connects to a non-emulator host.
 *
 * Skipped is NOT passed. D-EMU is recorded as NOT RUN until the owner runs the procedure in VERIFICATION.md "D-EMU manual gate"
 * and records the evidence. Java is required for the emulator, and it is not installed by this repository.
 *
 * The race, as the SPEC requires:
 * 1. a protected write transaction begins and reads the erasure fence (absent);
 * 2. another committed operation creates the fence after that read and before the protected transaction commits;
 * 3. the protected transaction tries to commit its business write;
 * 4. Firestore's transaction conflict/retry semantics re-run the callback, which now observes the fence and refuses;
 * 5. the business write does not exist after the refusal.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.DEVPULSE_EMULATOR_PROJECT;
const CONFIGURED = typeof EMULATOR_HOST === "string" && EMULATOR_HOST.length > 0 && typeof PROJECT_ID === "string" && PROJECT_ID.startsWith("demo-");

const APP_NAME = "erasure-fence-race-emulator";
const UID = "uid-race-emulator";
const BUSINESS_PATH = `forumReplies/race-reply-${UID}`;

describe.skipIf(!CONFIGURED)("D-EMU: erasure fence commit-ordering race on the real Firestore Emulator", () => {
  let app: App | undefined;
  let db: Firestore;

  beforeAll(() => {
    // The emulator needs no credentials. A demo project id keeps every operation local.
    app = initializeApp({ projectId: PROJECT_ID as string }, APP_NAME);
    db = getFirestore(app);
  });

  afterAll(async () => {
    await db.doc(`accountErasures/${UID}`).delete();
    await db.doc(BUSINESS_PATH).delete();
    if (app !== undefined) await deleteApp(app);
  });

  it("a protected write that read an absent fence does not commit once the fence is created concurrently", async () => {
    await db.doc(`accountErasures/${UID}`).delete();
    await db.doc(BUSINESS_PATH).delete();

    let callbackRuns = 0;
    let fenceCreatedOnce = false;
    const attempt = runFencedTransaction(db, UID, async (tx) => {
      callbackRuns += 1;
      // The fence read inside the callback has already happened (runFencedTransaction reads it first). Create the fence from
      // a separate, committed operation on the first run only, so the protected transaction's read is stale at commit.
      if (!fenceCreatedOnce) {
        fenceCreatedOnce = true;
        await db.doc(`accountErasures/${UID}`).create({ status: "in_progress", step: "forum" });
      }
      tx.create(db.doc(BUSINESS_PATH), { body: "late write" });
    });

    await expect(attempt).rejects.toBeInstanceOf(ErasureWriteRefused);
    // Firestore re-ran the callback because the fence read changed before commit. The retry observed the fence.
    expect(callbackRuns).toBeGreaterThanOrEqual(2);
    expect((await db.doc(BUSINESS_PATH).get()).exists).toBe(false);
  });

  it("an unrelated uid's protected write still commits while another uid's fence exists", async () => {
    const OTHER = "uid-race-emulator-other";
    await db.doc(`accountErasures/${OTHER}`).create({ status: "in_progress", step: "forum" });
    try {
      const path = `forumReplies/race-reply-${OTHER}-clear`;
      await runFencedTransaction(db, "uid-race-emulator-clear", async (tx) => {
        tx.create(db.doc(path), { body: "unrelated" });
      });
      expect((await db.doc(path).get()).exists).toBe(true);
      await db.doc(path).delete();
    } finally {
      await db.doc(`accountErasures/${OTHER}`).delete();
    }
  });
});

import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { demoCrypto } from "../crypto";
import { DEMO_MEMBER_IDENTITIES, buildIdentityMembership } from "../identities/fixtures";
import { isValidForumThread } from "../../forum/domain/forum-thread";
import { forumThreadContext } from "../../forum/domain/forum-thread";
import { DEMO_FORUM_THREADS, buildForumThreadDocument } from "./fixtures";
import { createForumOnlineAdapters } from "./adapters";
import { runForumProvisioning } from "./runner";

/**
 * Emulator suite for the forum fixture seed (Phase D). Runs the real runner and the real Firebase Admin SDK against the
 * Firestore emulator only. Skipped unless `FIRESTORE_EMULATOR_HOST` and `DEVPULSE_EMULATOR_PROJECT` are set (TESTING.md §1a).
 * Every run uses a fresh `demo-` project id and clears it afterwards. No live project is ever contacted.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PRESENTER = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
const TEAM = "8yB2bS8Jav69TCfDETON";
const AS_OF = new Date("2026-11-16T00:00:00.000Z");
const PROJECT = `demo-forum-seed-${Date.now()}`;
const TOTAL_DOCS = DEMO_FORUM_THREADS.length + DEMO_FORUM_THREADS.reduce((sum, t) => sum + t.replies.length, 0);
const ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");

const enabled = Boolean(EMULATOR_HOST) && process.env.DEVPULSE_EMULATOR_PROJECT !== undefined;

describe.skipIf(!enabled)("forum fixture seed on the Firestore emulator", () => {
  let db: import("firebase-admin/firestore").Firestore;
  let seedSdk: Parameters<typeof createForumOnlineAdapters>[0]["sdk"];

  beforeAll(async () => {
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    const adminApp = await import("firebase-admin/app");
    const firestore = await import("firebase-admin/firestore");
    // The emulator ignores signatures, but the SDK requires a service-account credential. A throwaway key is generated per
    // run in memory, is never stored, and is never sent to a real service.
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const credential = adminApp.cert({ projectId: PROJECT, clientEmail: `emulator@${PROJECT}.iam.gserviceaccount.com`, privateKey });
    // The seed's own cert() is replaced by the emulator credential; the app is reused by name, as in the production adapter.
    const sdk = {
      cert: () => ({}),
      initializeApp: (options: { projectId: string }, name: string) => {
        try {
          return adminApp.getApp(name);
        } catch {
          return adminApp.initializeApp({ credential, projectId: options.projectId }, name);
        }
      },
      getFirestore: (app: unknown) => firestore.getFirestore(app as import("firebase-admin/app").App),
      getAuth: () => {
        throw new Error("not used");
      },
    } as unknown as Parameters<typeof createForumOnlineAdapters>[0]["sdk"];

    db = firestore.getFirestore(adminApp.initializeApp({ credential, projectId: PROJECT }, "forum-seed-test-setup"));

    await db.doc(`teams/${TEAM}`).set({ status: "active" });
    await db.doc(`teamMemberships/${PRESENTER}__${TEAM}`).set({ uid: PRESENTER, teamId: TEAM, role: "teamadmin" });
    for (const identity of DEMO_MEMBER_IDENTITIES) {
      await db.doc(`teamMemberships/${identity.uid}__${TEAM}`).set(buildIdentityMembership(identity, TEAM, AS_OF));
    }
    seedSdk = sdk;
  }, 60_000);

  const run = (extra: string[]) =>
    runForumProvisioning({
      argv: ["--project", PROJECT, "--presenter-uid", PRESENTER, "--team-id", TEAM, "--as-of", "2026-11-16", ...extra],
      env: { FIREBASE_PROJECT_ID: PROJECT, FIREBASE_CLIENT_EMAIL: `seed@${PROJECT}.iam.gserviceaccount.com`, FIREBASE_PRIVATE_KEY: "not-a-real-key" },
      now: () => AS_OF,
      crypto: demoCrypto,
      createOnlineAdapters: async () =>
        createForumOnlineAdapters({ sdk: seedSdk, projectId: PROJECT, clientEmail: "seed@x", privateKey: "not-a-real-key" }),
    });

  afterAll(async () => {
    if (!EMULATOR_HOST) return;
    await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  });

  it("creates every thread and reply on a confirmed write, readable and sealed in the emulator", async () => {
    const result = await run(["--write", `--confirm=${PROJECT}`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.join("\n")).toContain(`created ${TOTAL_DOCS} forum documents`);

    const first = DEMO_FORUM_THREADS[0];
    const snapshot = await db.doc(`forumThreads/${first.threadId}`).get();
    const data = snapshot.data() as Record<string, unknown>;
    expect(isValidForumThread({ ...data, createdAt: (data.createdAt as { toDate: () => Date }).toDate() })).toBe(true);
    expect(JSON.stringify(data)).not.toContain(first.title);
    const opened = JSON.parse(
      demoCrypto.openRecord(
        { ciphertext: data.ciphertext as string, iv: data.iv as string, authTag: data.authTag as string, keyVersion: data.keyVersion as "v2", keyId: data.keyId as "k1" },
        forumThreadContext(TEAM, first.threadId),
      ),
    );
    expect(opened.title).toBe(first.title);
  });

  it("is a no-op on rerun and leaves the stored ciphertext byte-for-byte unchanged", async () => {
    const before = await db.doc(`forumThreads/${DEMO_FORUM_THREADS[0].threadId}`).get();
    const rerun = await run(["--write", `--confirm=${PROJECT}`]);
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout.join("\n")).toContain("nothing to write");
    const after = await db.doc(`forumThreads/${DEMO_FORUM_THREADS[0].threadId}`).get();
    expect(after.data()).toEqual(before.data());
  });

  it("stops on a conflicting existing thread, leaves it unchanged and writes nothing else", async () => {
    // Test setup only: replace one fixture thread with different sealed content, then expect the seeder to refuse.
    const target = DEMO_FORUM_THREADS[1];
    const conflicting = buildForumThreadDocument({ ...target, body: "En helt annen tekst enn fixturen." }, TEAM, demoCrypto.sealRecord);
    await db.doc(`forumThreads/${target.threadId}`).set(conflicting);
    const before = await db.doc(`forumThreads/${target.threadId}`).get();

    const result = await run(["--write", `--confirm=${PROJECT}`]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.join("\n")).toContain(`Conflict: forumThreads/${target.threadId} (content-differs)`);
    const after = await db.doc(`forumThreads/${target.threadId}`).get();
    expect(after.data()).toEqual(before.data());
  });
});

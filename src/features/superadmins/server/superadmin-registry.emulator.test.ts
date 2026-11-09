import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Firestore EMULATOR verification of the superadmin registry and the atomic erasure start (SR-T5/SR-T9).
 *
 * Runs only with a local emulator: `FIRESTORE_EMULATOR_HOST` is set (the emulator sets it) and `DEVPULSE_EMULATOR_PROJECT`
 * is a `demo-` project id. It never reads real credentials and never reaches a non-emulator host. Skipped otherwise.
 *
 * The production store and the production erasure start port run unchanged; only `getFirestoreDb` is routed to the emulator.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.DEVPULSE_EMULATOR_PROJECT;
const CONFIGURED =
  typeof EMULATOR_HOST === "string" && EMULATOR_HOST.length > 0 && typeof PROJECT_ID === "string" && PROJECT_ID.startsWith("demo-");

const db = vi.hoisted(() => ({ current: undefined as Firestore | undefined }));

vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => {
    if (db.current === undefined) throw new Error("emulator database not initialised");
    return db.current;
  },
  getAdminAuth: () => {
    throw new Error("auth is not used by the emulator suite");
  },
}));

const { grantSuperadmin, revokeSuperadmin, listSuperadmins } = await import("./superadmin-operations");
const { getDefaultErasureStartPort, startErasureAtomically } = await import("../../../features/account-erasure/server/erasure-start-atomic");
const { verifyToken, USERS } = await import("./superadmin-registry.test-helper");

const ERASURE_UIDS = ["erasing-uid", "fenced-uid"];
const noFence = async () => ({ kind: "none" as const });

async function resetRegistry(store: Firestore) {
  const superadmins = await store.collection("superadmins").get();
  await Promise.all(superadmins.docs.map((doc) => doc.ref.delete()));
  await store.collection("superadminRegistry").doc("control").delete();
  await Promise.all(ERASURE_UIDS.map((uid) => store.collection("accountErasures").doc(uid).delete()));
}

async function seed(store: Firestore, active: string[]) {
  for (const uid of active) {
    await store.collection("superadmins").doc(uid).set({ uid, active: true, grantedAt: new Date(0), grantedByUid: null, revokedAt: null, revokedByUid: null, updatedAt: new Date(0) });
  }
  await store.collection("superadminRegistry").doc("control").set({ activeCount: active.length, updatedAt: new Date(0) });
}

async function recordOf(store: Firestore, uid: string) {
  return (await store.collection("superadmins").doc(uid).get()).data();
}

async function countActive(store: Firestore) {
  const snapshot = await store.collection("superadmins").where("active", "==", true).get();
  return snapshot.size;
}

async function controlOf(store: Firestore) {
  return (await store.collection("superadminRegistry").doc("control").get()).data()?.activeCount;
}

const lookupByEmail = (email: string) => {
  const user = Object.values(USERS).find((candidate) => candidate.email === email);
  return user && { uid: user.uid, emailVerified: user.emailVerified !== false, disabled: user.disabled === true };
};

describe.skipIf(!CONFIGURED)("superadmin registry on the Firestore emulator (SR-T5, SR-T9)", () => {
  let app: App | undefined;
  let store: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID as string }, "superadmin-registry-emulator");
    store = getFirestore(app);
    db.current = store;
  });

  beforeEach(async () => {
    await resetRegistry(store);
  });

  afterAll(async () => {
    await resetRegistry(store);
    if (app !== undefined) await deleteApp(app);
  });

  const operationDeps = {
    verifyToken,
    readFence: noFence,
    lookupAuthUserByEmail: async (email: string) => lookupByEmail(email),
  };

  it("grants and revokes through the real transaction, keeping the control count exact", async () => {
    await seed(store, ["admin-uid"]);

    const granted = await grantSuperadmin("admin-uid", USERS.second.email, operationDeps);
    expect(granted).toEqual({ ok: true, outcome: "granted", targetUid: "second-uid" });
    expect(await controlOf(store)).toBe(2);
    expect(await recordOf(store, "second-uid")).toMatchObject({ active: true, grantedByUid: "admin-uid" });

    const revoked = await revokeSuperadmin("admin-uid", "second-uid", operationDeps);
    expect(revoked).toEqual({ ok: true, targetUid: "second-uid" });
    expect(await controlOf(store)).toBe(1);
    expect(await recordOf(store, "second-uid")).toMatchObject({ active: false, revokedByUid: "admin-uid" });
    expect(await countActive(store)).toBe(1);
  });

  it("is idempotent on the emulator: a duplicate grant writes nothing and keeps the count", async () => {
    await seed(store, ["admin-uid", "second-uid"]);
    const before = await recordOf(store, "second-uid");

    expect(await grantSuperadmin("admin-uid", USERS.second.email, operationDeps)).toEqual({
      ok: true,
      outcome: "already_superadmin",
      targetUid: "second-uid",
    });
    expect(await recordOf(store, "second-uid")).toEqual(before);
    expect(await controlOf(store)).toBe(2);
  });

  it("refuses the last active superadmin's revoke and leaves the record active", async () => {
    await seed(store, ["admin-uid"]);

    expect(await revokeSuperadmin("admin-uid", "admin-uid", operationDeps)).toEqual({ ok: false, error: "last_superadmin" });
    expect(await recordOf(store, "admin-uid")).toMatchObject({ active: true });
    expect(await controlOf(store)).toBe(1);
  });

  it("never leaves zero superadmins under concurrent revocations of the two remaining superadmins (repeated)", async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetRegistry(store);
      await seed(store, ["admin-uid", "second-uid"]);

      const [a, b] = await Promise.all([
        revokeSuperadmin("admin-uid", "second-uid", operationDeps),
        revokeSuperadmin("second-uid", "admin-uid", operationDeps),
      ]);

      // Exactly one revoke can succeed. The other sees the updated count (or the revoked actor) and is refused.
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(await countActive(store)).toBe(1);
      expect(await controlOf(store)).toBe(1);
    }
  }, 60_000);

  it("does not let a concurrent erasure start and a revoke both remove superadmins of a two-person registry", async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetRegistry(store);
      await seed(store, ["admin-uid", "second-uid"]);

      const [revoke, start] = await Promise.all([
        revokeSuperadmin("admin-uid", "second-uid", operationDeps),
        startErasureAtomically(getDefaultErasureStartPort(), "admin-uid", new Date()),
      ]);

      // Both target the registry count. Whatever order Firestore picks, at least one active superadmin must remain.
      expect(await countActive(store)).toBeGreaterThanOrEqual(1);
      expect(await controlOf(store)).toBe(await countActive(store));
      expect(revoke.ok && start.ok).toBe(false);
    }
  }, 60_000);

  it("refuses a grant to an account whose erasure fence exists (fenced write, no record written)", async () => {
    await seed(store, ["admin-uid"]);
    await store.collection("accountErasures").doc("fenced-uid").set({ status: "in_progress", step: "forum", startedAt: new Date(), updatedAt: new Date() });

    const result = await grantSuperadmin("admin-uid", "fenced@example.test", {
      ...operationDeps,
      lookupAuthUserByEmail: async () => ({ uid: "fenced-uid", emailVerified: true, disabled: false }),
    });

    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    expect((await store.collection("superadmins").doc("fenced-uid").get()).exists).toBe(false);
    expect(await controlOf(store)).toBe(1);
  });

  it("starts an erasure for a superadmin with the fence and the revoke committed together", async () => {
    await seed(store, ["erasing-uid", "admin-uid"]);

    const result = await startErasureAtomically(getDefaultErasureStartPort(), "erasing-uid", new Date());

    expect(result).toMatchObject({ ok: true, created: true });
    expect((await store.collection("accountErasures").doc("erasing-uid").get()).data()).toMatchObject({ status: "in_progress" });
    expect(await recordOf(store, "erasing-uid")).toMatchObject({ active: false });
    expect(await controlOf(store)).toBe(1);
  });

  it("refuses to start an erasure for the last active superadmin and writes neither the fence nor the revoke", async () => {
    await seed(store, ["erasing-uid"]);

    expect(await startErasureAtomically(getDefaultErasureStartPort(), "erasing-uid", new Date())).toEqual({
      ok: false,
      error: "last_superadmin",
    });
    expect((await store.collection("accountErasures").doc("erasing-uid").get()).exists).toBe(false);
    expect(await recordOf(store, "erasing-uid")).toMatchObject({ active: true });
    expect(await controlOf(store)).toBe(1);
  });

  it("lists only active superadmins from the emulator", async () => {
    await seed(store, ["admin-uid"]);
    await store.collection("superadmins").doc("dev-uid").set({ uid: "dev-uid", active: false, grantedAt: new Date(0) });

    const result = await listSuperadmins("admin-uid", operationDeps);

    expect(result.ok && result.superadmins.map((entry) => entry.uid)).toEqual(["admin-uid"]);
  });
});

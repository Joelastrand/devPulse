import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp, type App as AdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from "firebase-admin/firestore";
import { deleteApp as deleteClientApp, initializeApp as initializeClientApp, type FirebaseApp } from "firebase/app";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, setDoc, type Firestore } from "firebase/firestore";

/**
 * Client SDK access to the superadmin registry, against the Firestore EMULATOR and the repository's `firestore.rules` (SR-SI-7).
 * Every client read and write is unauthenticated here and must be denied. Only the Admin SDK may touch the registry.
 *
 * Runs only with `FIRESTORE_EMULATOR_HOST` set and a `demo-` project id, like the other emulator suites. Skipped otherwise.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.DEVPULSE_EMULATOR_PROJECT;
const CONFIGURED =
  typeof EMULATOR_HOST === "string" && EMULATOR_HOST.length > 0 && typeof PROJECT_ID === "string" && PROJECT_ID.startsWith("demo-");

describe.skipIf(!CONFIGURED)("superadmin registry client rules on the Firestore emulator (SR-SI-7)", () => {
  let adminApp: AdminApp | undefined;
  let clientApp: FirebaseApp | undefined;
  let admin: AdminFirestore;
  let client: Firestore;

  beforeAll(async () => {
    // A project id of its own: the other emulator suite runs in parallel against the emulator and must not share documents.
    adminApp = initializeAdminApp({ projectId: `${PROJECT_ID}-rules` }, "registry-rules-admin");
    admin = getAdminFirestore(adminApp);
    await admin.collection("superadmins").doc("admin-uid").set({ uid: "admin-uid", active: true, grantedAt: new Date(0) });
    await admin.collection("superadminRegistry").doc("control").set({ activeCount: 1 });

    clientApp = initializeClientApp({ projectId: `${PROJECT_ID}-rules`, apiKey: "demo-api-key" }, "registry-rules-client");
    client = getFirestore(clientApp);
    const [hostname, port] = (EMULATOR_HOST as string).split(":");
    connectFirestoreEmulator(client, hostname, Number(port));
  });

  afterAll(async () => {
    await admin.collection("superadmins").doc("admin-uid").delete();
    await admin.collection("superadminRegistry").doc("control").delete();
    if (clientApp !== undefined) await deleteClientApp(clientApp);
    if (adminApp !== undefined) await deleteAdminApp(adminApp);
  });

  it("denies an unauthenticated client read of an existing superadmin record", async () => {
    await expect(getDoc(doc(client, "superadmins/admin-uid"))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("denies an unauthenticated client listing of the superadmins collection", async () => {
    await expect(getDocs(collection(client, "superadmins"))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("denies an unauthenticated client read of the registry control document", async () => {
    await expect(getDoc(doc(client, "superadminRegistry/control"))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("denies an unauthenticated client write that tries to self-grant superadmin", async () => {
    await expect(
      setDoc(doc(client, "superadmins/attacker-uid"), { uid: "attacker-uid", active: true, grantedByUid: null }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect((await admin.collection("superadmins").doc("attacker-uid").get()).exists).toBe(false);
  });

  it("denies an unauthenticated client write to the registry control document", async () => {
    await expect(setDoc(doc(client, "superadminRegistry/control"), { activeCount: 0 })).rejects.toMatchObject({
      code: "permission-denied",
    });
  });
});

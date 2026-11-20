import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp, type App as AdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from "firebase-admin/firestore";
import { deleteApp as deleteClientApp, initializeApp as initializeClientApp, type FirebaseApp } from "firebase/app";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, setDoc, type Firestore } from "firebase/firestore";

/**
 * Client SDK access to private owner conversations, the participation index and team memberships, against the Firestore
 * EMULATOR and the repository's `firestore.rules` (A2.1). The shared-team binding is verified only by the server, so the rules
 * cannot grant access from any client claim. Every unauthenticated client read, list and write must be denied here.
 *
 * Runs only with `FIRESTORE_EMULATOR_HOST` set and a `demo-` project id, like the other emulator suites. Skipped otherwise.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.DEVPULSE_EMULATOR_PROJECT;
const CONFIGURED =
  typeof EMULATOR_HOST === "string" && EMULATOR_HOST.length > 0 && typeof PROJECT_ID === "string" && PROJECT_ID.startsWith("demo-");

const OWNER = "emu-conv-rules-owner";
const CONVERSATION = "emu-conv-rules-1";

describe.skipIf(!CONFIGURED)("conversation client rules on the Firestore emulator (A2.1)", () => {
  let adminApp: AdminApp | undefined;
  let clientApp: FirebaseApp | undefined;
  let admin: AdminFirestore;
  let client: Firestore;

  beforeAll(async () => {
    // A project id of its own, so this suite never shares documents with the other emulator suites running in parallel.
    adminApp = initializeAdminApp({ projectId: `${PROJECT_ID}-conv-rules` }, "conv-rules-admin");
    admin = getAdminFirestore(adminApp);
    await admin
      .collection("userDevelopment")
      .doc(OWNER)
      .collection("conversations")
      .doc(CONVERSATION)
      .set({ participantUid: null, status: "open" });
    await admin.collection("teamMemberships").doc(`${OWNER}__emu-team`).set({ uid: OWNER, teamId: "emu-team", memberRef: "2468ace7bdfhjkmnpqrstvwxyz" });

    clientApp = initializeClientApp({ projectId: `${PROJECT_ID}-conv-rules`, apiKey: "demo-api-key" }, "conv-rules-client");
    client = getFirestore(clientApp);
    const [hostname, port] = (EMULATOR_HOST as string).split(":");
    connectFirestoreEmulator(client, hostname, Number(port));
  });

  afterAll(async () => {
    await admin.collection("userDevelopment").doc(OWNER).collection("conversations").doc(CONVERSATION).delete();
    await admin.collection("teamMemberships").doc(`${OWNER}__emu-team`).delete();
    if (clientApp !== undefined) await deleteClientApp(clientApp);
    if (adminApp !== undefined) await deleteAdminApp(adminApp);
  });

  it("denies an unauthenticated client read of a private owner conversation", async () => {
    await expect(getDoc(doc(client, `userDevelopment/${OWNER}/conversations/${CONVERSATION}`))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("denies an unauthenticated client listing of an owner's conversations", async () => {
    await expect(getDocs(collection(client, `userDevelopment/${OWNER}/conversations`))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("denies an unauthenticated client read of a participation index entry", async () => {
    await expect(getDoc(doc(client, `userDevelopment/${OWNER}/conversationParticipations/${CONVERSATION}`))).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("denies an unauthenticated client read of a team membership, so no client can test a shared team", async () => {
    await expect(getDoc(doc(client, `teamMemberships/${OWNER}__emu-team`))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("denies an unauthenticated client write that tries to bind a participant to a conversation", async () => {
    await expect(
      setDoc(doc(client, `userDevelopment/${OWNER}/conversations/${CONVERSATION}`), { participantUid: "attacker", participantState: "accepted" }, { merge: true }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    const stored = await admin.collection("userDevelopment").doc(OWNER).collection("conversations").doc(CONVERSATION).get();
    expect(stored.data()?.participantUid).toBeNull();
  });

  it("denies an unauthenticated client write that tries to add a membership and so fake a shared team", async () => {
    await expect(setDoc(doc(client, `teamMemberships/attacker__emu-team`), { uid: "attacker", teamId: "emu-team" })).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect((await admin.collection("teamMemberships").doc("attacker__emu-team").get()).exists).toBe(false);
  });
});

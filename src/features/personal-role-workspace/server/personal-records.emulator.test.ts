import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp as deleteClientApp, initializeApp as initializeClientApp, type FirebaseApp } from "firebase/app";
import { connectFirestoreEmulator, doc, getDoc, getDocs, collection, getFirestore, setDoc, type Firestore } from "firebase/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { createPersonalDataPort } from "../../account-erasure/server/erasure-adapters";
import {
  createAchievement,
  createResponsibility,
  deleteResponsibility,
  listResponsibilities,
  updateResponsibility,
  type PersonalRecordDeps,
  productionPersonalRecordDeps,
} from "./record-operations";

/**
 * Personal records against the Firestore EMULATOR (SECURITY-REVIEW §11.6). The production Admin SDK store, the production
 * erasure adapter and the repository's `firestore.rules` run here, not a fake. Runs only with `FIRESTORE_EMULATOR_HOST` and a
 * `demo-` project id, like the other emulator suites. Skipped otherwise. Synthetic fixtures only.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.DEVPULSE_EMULATOR_PROJECT;
const CONFIGURED =
  typeof EMULATOR_HOST === "string" && EMULATOR_HOST.length > 0 && typeof PROJECT_ID === "string" && PROJECT_ID.startsWith("demo-");

const KEY = Buffer.alloc(32, 5).toString("base64");
const OWNER = "emu-owner-uid";
const OTHER = "emu-other-uid";
const GOAL = "emu-goal-1";
const SECRET_TITLE = "Syntetisk ansvarstittel";

describe.skipIf(!CONFIGURED)("personal records on the Firestore emulator (PR-SI-1, PR-SI-5, I-17, I-18)", () => {
  let clientApp: FirebaseApp | undefined;
  let client: Firestore;
  let deps: PersonalRecordDeps;
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalProject = process.env.FIREBASE_PROJECT_ID;

  beforeAll(async () => {
    process.env.FIREBASE_PROJECT_ID = `${PROJECT_ID}-prw`;
    process.env.ENCRYPTION_KEY = KEY;
    deps = { ...productionPersonalRecordDeps(), goalExists: async (uid, goalId) => uid === OWNER && goalId === GOAL };
    clientApp = initializeClientApp({ projectId: `${PROJECT_ID}-prw`, apiKey: "demo-api-key" }, "prw-rules-client");
    client = getFirestore(clientApp);
    const [hostname, port] = (EMULATOR_HOST as string).split(":");
    connectFirestoreEmulator(client, hostname, Number(port));
  });

  afterAll(async () => {
    const db = getFirestoreDb();
    for (const uid of [OWNER, OTHER]) {
      const responsibilities = await db.collection("userDevelopment").doc(uid).collection("responsibilities").get();
      const achievements = await db.collection("userDevelopment").doc(uid).collection("achievements").get();
      await Promise.all([...responsibilities.docs, ...achievements.docs].map((snapshot) => snapshot.ref.delete()));
      await db.collection("accountErasures").doc(uid).delete();
    }
    if (clientApp !== undefined) await deleteClientApp(clientApp);
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    if (originalProject === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = originalProject;
  });

  it("denies unauthenticated client reads and writes of both personal subtrees (client rules)", async () => {
    await expect(getDoc(doc(client, `userDevelopment/${OWNER}/responsibilities/any`))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(getDocs(collection(client, `userDevelopment/${OWNER}/achievements`))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(setDoc(doc(client, `userDevelopment/${OWNER}/responsibilities/forged`), { title: "x" })).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("stores encrypted content in Firestore, reads it back through the server store, and never stores the plaintext", async () => {
    const created = await createResponsibility(
      OWNER,
      { title: SECRET_TITLE, description: "Syntetisk beskrivelse", status: "active", relationToRole: "within", startDate: null, endDate: null, goalIds: [GOAL] },
      deps,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const raw = await getFirestoreDb().collection("userDevelopment").doc(OWNER).collection("responsibilities").doc(String(created.dto.id)).get();
    const stored = JSON.stringify(raw.data());
    expect(stored).not.toContain(SECRET_TITLE);
    expect(stored).not.toContain("Syntetisk beskrivelse");

    const list = await listResponsibilities(OWNER, deps);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.result.items).toEqual([expect.objectContaining({ kind: "record", dto: expect.objectContaining({ title: SECRET_TITLE }) })]);
  });

  it("returns not_found to another user for update and delete, and the owner's record is unchanged", async () => {
    const created = await createResponsibility(OWNER, { title: "Eier", description: null, status: "active", relationToRole: "unspecified", startDate: null, endDate: null, goalIds: [] }, deps);
    if (!created.ok) throw new Error("setup failed");
    const id = String(created.dto.id);
    expect(await updateResponsibility(OTHER, id, { title: "Stjålet" }, deps)).toEqual({ ok: false, error: "not_found" });
    expect(await deleteResponsibility(OTHER, id, deps)).toEqual({ ok: false, error: "not_found" });
    const otherList = await listResponsibilities(OTHER, deps);
    expect(otherList.ok && otherList.result.items.some((item) => item.kind === "record" && item.dto.id === id)).toBe(false);
  });

  it("refuses a create while the erasure record exists, and writes nothing (W-19 fence on the emulator)", async () => {
    await getFirestoreDb().collection("accountErasures").doc(OTHER).set({ status: "in_progress" });
    const result = await createAchievement(
      OTHER,
      { title: "Resultat", description: "Syntetisk", outcome: null, relationToRole: "beyond", periodStart: null, periodEnd: null, goalIds: [], responsibilityIds: [] },
      deps,
    );
    expect(result).toEqual({ ok: false, error: "erasure_in_progress" });
    const achievements = await getFirestoreDb().collection("userDevelopment").doc(OTHER).collection("achievements").get();
    expect(achievements.size).toBe(0);
    await getFirestoreDb().collection("accountErasures").doc(OTHER).delete();
  });

  it("the erasure port removes both personal subtrees by path, and needs no encryption key", async () => {
    const responsibility = await createResponsibility(OWNER, { title: "Erasure", description: null, status: "completed", relationToRole: "within", startDate: null, endDate: null, goalIds: [] }, deps);
    const achievement = await createAchievement(OWNER, { title: "Erasure", description: "Syntetisk", outcome: null, relationToRole: "beyond", periodStart: null, periodEnd: null, goalIds: [], responsibilityIds: [] }, deps);
    expect(responsibility.ok && achievement.ok).toBe(true);

    const port = createPersonalDataPort();
    delete process.env.ENCRYPTION_KEY;
    try {
      const responsibilityIds = await port.responsibilityIds(OWNER, 100);
      const achievementIds = await port.achievementIds(OWNER, 200);
      expect(responsibilityIds.length).toBeGreaterThan(0);
      expect(achievementIds.length).toBeGreaterThan(0);
      for (const id of responsibilityIds) await port.deleteResponsibility(OWNER, id);
      for (const id of achievementIds) await port.deleteAchievement(OWNER, id);
    } finally {
      process.env.ENCRYPTION_KEY = KEY;
    }
    expect(await port.responsibilityIds(OWNER, 100)).toEqual([]);
    expect(await port.achievementIds(OWNER, 200)).toEqual([]);
  });
});

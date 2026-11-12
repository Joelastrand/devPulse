import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { openRoadmapItemDocument, toPersistedRoadmapItem } from "../../roadmap/domain/roadmap-item-content-codec";
import { toPersistedTeamSystem } from "../../team-systems/server/team-system-codec";
import { createMembershipPort } from "./erasure-adapters-team";
import { createMembershipStepHandler } from "./membership-erasure";

/**
 * Membership erasure step on the REAL local Firestore Emulator (owner decision 2026-11-08: BR-17(1) is superseded, so every
 * memberRef-dependent reference of an erased membership must be cleared before the membership is deleted, and completion must
 * not be reported while one remains).
 *
 * Covers A-5 (roadmapItems.ownerRef), A-14 (teamSystems.knowledgeMemberRefs), A-15 (teamProjectParticipations.memberRef) and the
 * membership delete (I-9). I-7 bindings are discovered by participantUid in the participant_bindings step, which runs after this one.
 *
 * Runs only with `FIRESTORE_EMULATOR_HOST` set and `DEVPULSE_EMULATOR_PROJECT` set to a `demo-` project. Skipped otherwise.
 * Every fixture is synthetic. Other people's records and other teams' records must stay exactly as they were.
 */

// Real emulator round trips are slow on this machine; the default 5s/10s budgets are too tight for seeded transactions.
if (process.env.FIRESTORE_EMULATOR_HOST) vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.DEVPULSE_EMULATOR_PROJECT;
const CONFIGURED = typeof EMULATOR_HOST === "string" && EMULATOR_HOST.length > 0 && typeof PROJECT_ID === "string" && PROJECT_ID.startsWith("demo-");

const APP_NAME = "membership-erasure-emulator";
const UID = "uid-memb-emulator";
const OTHER_UID = "uid-memb-emulator-other";
const TEAM = "team-memb-emulator";
const OTHER_TEAM = "team-memb-emulator-2";
const REF = "mref-memb-emulator";
const OTHER_REF = "mref-memb-emulator-other";

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

const ITEM_IDS = ["memb-item-1", "memb-item-2", "memb-item-other-person", "memb-item-other-team"];
const SYSTEM_IDS = ["memb-system-1", "memb-system-other-team"];
const PARTICIPATION_IDS = ["memb-part-1", "memb-part-other-person"];
const MEMBERSHIP_IDS = [`${UID}__${TEAM}`, `${OTHER_UID}__${TEAM}`];

async function seed(database: Firestore): Promise<void> {
  await database.collection("teamMemberships").doc(`${UID}__${TEAM}`).set({ uid: UID, teamId: TEAM, memberRef: REF, role: "member" });
  await database.collection("teamMemberships").doc(`${OTHER_UID}__${TEAM}`).set({ uid: OTHER_UID, teamId: TEAM, memberRef: OTHER_REF, role: "member" });
  // Business content is sealed (encrypted-only collections). The owner index is written by the same codec as the app.
  const roadmap = database.collection("roadmapItems");
  const item = (teamId: string, ownerRef: string) => ({ teamId, treeId: "tree-synthetic", ownerRef, status: "planned", priority: "medium" });
  await roadmap.doc("memb-item-1").set(toPersistedRoadmapItem(item(TEAM, REF)));
  await roadmap.doc("memb-item-2").set(toPersistedRoadmapItem(item(TEAM, REF)));
  await roadmap.doc("memb-item-other-person").set(toPersistedRoadmapItem(item(TEAM, OTHER_REF)));
  await roadmap.doc("memb-item-other-team").set(toPersistedRoadmapItem(item(OTHER_TEAM, REF)));
  const systems = database.collection("teamSystems");
  await systems.doc("memb-system-1").set(toPersistedTeamSystem("memb-system-1", { teamId: TEAM, knowledgeMemberRefs: [REF, OTHER_REF], name: "Synthetic system", description: null }));
  await systems
    .doc("memb-system-other-team")
    .set(toPersistedTeamSystem("memb-system-other-team", { teamId: OTHER_TEAM, knowledgeMemberRefs: [REF], name: "Synthetic other team system", description: null }));
  const participations = database.collection("teamProjectParticipations");
  await participations.doc("memb-part-1").set({ teamId: TEAM, memberRef: REF, projectId: "p-synthetic" });
  await participations.doc("memb-part-other-person").set({ teamId: TEAM, memberRef: OTHER_REF, projectId: "p-synthetic" });
}

/** The plan's owner handle, opened from its sealed content (`ownerRef` is no longer a plaintext field). */
async function readOwnerRef(database: Firestore, id: string): Promise<unknown> {
  const snapshot = await database.collection("roadmapItems").doc(id).get();
  const opened = openRoadmapItemDocument(snapshot.data());
  return typeof opened === "object" && opened !== null ? (opened as Record<string, unknown>).ownerRef : undefined;
}

async function clean(database: Firestore): Promise<void> {
  await Promise.all([
    ...MEMBERSHIP_IDS.map((id) => database.collection("teamMemberships").doc(id).delete()),
    ...ITEM_IDS.map((id) => database.collection("roadmapItems").doc(id).delete()),
    ...SYSTEM_IDS.map((id) => database.collection("teamSystems").doc(id).delete()),
    ...PARTICIPATION_IDS.map((id) => database.collection("teamProjectParticipations").doc(id).delete()),
  ]);
}

/** Runs the production membership step one batch at a time, returning each batch's result. */
async function runStep(maxWrites: number, maxBatches = 50): Promise<string[]> {
  const handler = createMembershipStepHandler({ port: createMembershipPort() });
  const results: string[] = [];
  for (let i = 0; i < maxBatches; i++) {
    const result = await handler.runBatch({ uid: UID, maxWrites });
    results.push(result);
    if (result === "done") return results;
  }
  throw new Error("membership step did not reach done");
}

describe.skipIf(!CONFIGURED)("membership erasure on the Firestore Emulator (owner decision 2026-11-08)", () => {
  let app: App | undefined;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID as string }, APP_NAME);
    database = getFirestore(app);
    db.current = database;
  });

  beforeEach(async () => {
    await clean(database);
    await seed(database);
  });

  afterAll(async () => {
    await clean(database);
    db.current = undefined;
    if (app !== undefined) await deleteApp(app);
  });

  it("clears every memberRef-dependent reference of the erased membership before deleting the membership", async () => {
    await runStep(10);

    expect((await database.collection("teamMemberships").doc(`${UID}__${TEAM}`).get()).exists).toBe(false);
    // A detached plan has no owner: the key is removed (domain `ownerRef` is optional), not set to null.
    expect(await readOwnerRef(database, "memb-item-1")).toBeUndefined();
    expect(await readOwnerRef(database, "memb-item-2")).toBeUndefined();
    expect((await database.collection("teamSystems").doc("memb-system-1").get()).data()?.knowledgeMemberRefs).toEqual([OTHER_REF]);
    expect((await database.collection("teamProjectParticipations").doc("memb-part-1").get()).exists).toBe(false);
  });

  it("never reports done while a reference remains and the membership still exists", async () => {
    const results = await runStep(1);

    // One write per batch with several dependents: every batch before the last must report more work.
    expect(results.slice(0, -1).every((result) => result === "more")).toBe(true);
    expect(results.at(-1)).toBe("done");
  });

  it("leaves another person's references and another team's records untouched", async () => {
    await runStep(10);

    expect(await readOwnerRef(database, "memb-item-other-person")).toBe(OTHER_REF);
    expect(await readOwnerRef(database, "memb-item-other-team")).toBe(REF);
    expect((await database.collection("teamSystems").doc("memb-system-other-team").get()).data()?.knowledgeMemberRefs).toEqual([REF]);
    expect((await database.collection("teamProjectParticipations").doc("memb-part-other-person").get()).exists).toBe(true);
    expect((await database.collection("teamMemberships").doc(`${OTHER_UID}__${TEAM}`).get()).exists).toBe(true);
  });
});

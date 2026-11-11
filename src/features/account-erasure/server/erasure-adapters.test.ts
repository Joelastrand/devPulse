import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdminFirestore } from "./admin-firestore.test-helper";

// TASK-038: runtime coverage of the production Admin SDK adapters for the port-based steps. The Admin Firestore surface is
// the recording double (structural). Real Firestore conflict behaviour is the D-EMU gate, not claimed here.

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../../../lib/firebase/admin", () => ({ getFirestoreDb: () => holder.db }));
vi.mock("server-only", () => ({}));

import {
  createActorAuditPort,
  createPersonalDataPort,
  createSurveyParticipationsPort,
} from "./erasure-adapters";

const UID = "uid-38";
const OTHER = "uid-other";
let db: FakeAdminFirestore;

beforeEach(() => {
  db = new FakeAdminFirestore();
  holder.db = db;
});

describe("personal data adapter", () => {
  it("reports and deletes the skill profile and user profile by document id, not other persons' documents", async () => {
    db.docs.set(`skillProfiles/${UID}`, { levels: 1 });
    db.docs.set(`skillProfiles/${OTHER}`, { levels: 2 });
    db.docs.set(`userProfiles/${UID}`, { displayName: "x" });
    const port = createPersonalDataPort();

    expect(await port.skillProfileExists(UID)).toBe(true);
    await port.deleteSkillProfile(UID);
    expect(await port.skillProfileExists(UID)).toBe(false);
    expect(db.docs.has(`skillProfiles/${OTHER}`)).toBe(true);

    expect(await port.userProfileExists(UID)).toBe(true);
    await port.deleteUserProfile(UID);
    expect(db.docs.has(`userProfiles/${UID}`)).toBe(false);
  });

  it("lists goal ids under the owner subtree only, bounded by the limit", async () => {
    db.docs.set(`userDevelopment/${UID}/goals/g1`, {});
    db.docs.set(`userDevelopment/${UID}/goals/g2`, {});
    db.docs.set(`userDevelopment/${UID}/goals/g3`, {});
    db.docs.set(`userDevelopment/${OTHER}/goals/foreign`, {});
    const port = createPersonalDataPort();

    expect(await port.goalIds(UID, 2)).toEqual(["g1", "g2"]);
    await port.deleteGoal(UID, "g1");
    expect(db.docs.has(`userDevelopment/${UID}/goals/g1`)).toBe(false);
    expect(db.docs.has(`userDevelopment/${OTHER}/goals/foreign`)).toBe(true);
  });

  it("deletes only the uid's own role assignment document (I-4), never a role definition", async () => {
    db.docs.set(`roleAssignments/${UID}`, { roleId: "role-1" });
    db.docs.set(`roleAssignments/${OTHER}`, { roleId: "role-1" });
    db.docs.set("roleDefinitions/role-1", { name: "Utvikler" });
    const port = createPersonalDataPort();

    expect(await port.roleAssignmentExists(UID)).toBe(true);
    await port.deleteRoleAssignment(UID);

    expect(db.docs.has(`roleAssignments/${UID}`)).toBe(false);
    expect(await port.roleAssignmentExists(UID)).toBe(false);
    expect(db.docs.has(`roleAssignments/${OTHER}`)).toBe(true);
    expect(db.docs.has("roleDefinitions/role-1")).toBe(true);
  });

  it("refuses a path-breaking uid before any read or write", async () => {
    const port = createPersonalDataPort();
    await expect(port.skillProfileExists("a/b")).rejects.toThrow("invalid uid segment");
    expect(db.reads).toEqual([]);
    expect(db.writes).toEqual([]);
  });
});

describe("survey participations adapter", () => {
  it("lists participations by uid field and by the uid__ document-id prefix, without duplicates", async () => {
    db.docs.set(`surveyParticipations/${UID}__s1`, { uid: UID, surveyId: "s1" });
    db.docs.set(`surveyParticipations/${UID}__s2`, { surveyId: "s2" }); // legacy: no uid field
    db.docs.set(`surveyParticipations/${OTHER}__s3`, { uid: OTHER, surveyId: "s3" });
    const port = createSurveyParticipationsPort();

    const ids = await port.participationIdsFor(UID, 10);

    expect(ids.sort()).toEqual([`${UID}__s1`, `${UID}__s2`]);
  });

  it("deletes one participation in a transaction and never reads or writes survey responses", async () => {
    db.docs.set(`surveyParticipations/${UID}__s1`, { uid: UID, surveyId: "s1" });
    db.docs.set(`surveyResponses/r1`, { surveyId: "s1" });
    const port = createSurveyParticipationsPort();

    const existed = await port.runTransaction((tx) => tx.getParticipation(`${UID}__s1`).then((raw) => raw !== undefined));
    await port.runTransaction(async (tx) => tx.deleteParticipation(`${UID}__s1`));

    expect(existed).toBe(true);
    expect(db.docs.has(`surveyParticipations/${UID}__s1`)).toBe(false);
    expect(db.docs.has("surveyResponses/r1")).toBe(true);
    expect([...db.reads, ...db.transactionalReads].some((path) => path.startsWith("surveyResponses/"))).toBe(false);
    expect(db.writes.map((w) => w.path)).toEqual([`surveyParticipations/${UID}__s1`]);
  });
});

describe("actor audit adapter", () => {
  it("finds the document whose actor field equals the uid, and clears only that field to null", async () => {
    db.docs.set("surveys/sv1", { createdBy: UID, title: "keep" });
    db.docs.set("surveys/sv2", { createdBy: OTHER });
    const port = createActorAuditPort();

    const id = await port.findActorReference(UID, { collection: "surveys", field: "createdBy" });
    expect(id).toBe("sv1");

    await port.runTransaction(async (tx) => {
      expect(await tx.getDocument({ collection: "surveys", field: "createdBy" }, "sv1")).toMatchObject({ createdBy: UID });
      tx.clearActorField({ collection: "surveys", field: "createdBy" }, "sv1");
    });

    expect(db.docs.get("surveys/sv1")).toEqual({ createdBy: null, title: "keep" });
    expect(db.docs.get("surveys/sv2")).toEqual({ createdBy: OTHER });
    expect(db.writes).toEqual([
      expect.objectContaining({ kind: "update", path: "surveys/sv1", data: { createdBy: null } }),
    ]);
  });

  it("returns undefined when no document names the uid", async () => {
    const port = createActorAuditPort();
    expect(await port.findActorReference(UID, { collection: "challenges", field: "resolvedBy" })).toBeUndefined();
  });
});

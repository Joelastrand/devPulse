import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { membershipDocId } from "../../teams/domain/team-membership";
import { toPersistedTeam } from "../../teams/domain/team-content-codec";
import { openParticipationDocument, toPersistedParticipation, toPersistedTeamProject } from "./team-project-codec";
import { writeProjectParticipation } from "./write-project-participation";

/**
 * Participation reassignment against the REAL local Firestore Emulator (TASK-005 roadmap editing, BR-8).
 *
 * Runs only when `FIRESTORE_EMULATOR_HOST` is set and `DEVPULSE_EMULATOR_PROJECT` is a `demo-` project id, so it never
 * reaches a real project. Run with:
 *   firebase emulators:exec --only firestore --project demo-devpulse-participation "pnpm exec vitest run <this file>"
 * Without the emulator the suite is skipped, and a skipped run is not a pass.
 *
 * What the in-memory unit tests cannot show: that the transaction reads and writes commit atomically, that two racing
 * reassignments leave one complete record (never a mix of both), and that a racing project archive cannot leave a record
 * on an archived project.
 */
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = process.env.DEVPULSE_EMULATOR_PROJECT;
const CONFIGURED = typeof EMULATOR_HOST === "string" && EMULATOR_HOST.length > 0 && typeof PROJECT_ID === "string" && PROJECT_ID.startsWith("demo-");
if (CONFIGURED) vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const APP_NAME = "write-project-participation-emulator";
const TEAM = "team-em-participation";
const OTHER_TEAM = "team-em-participation-other";
const LEAD_UID = "uid-em-lead";
const MEMBER_A_UID = "uid-em-member-a";
const MEMBER_B_UID = "uid-em-member-b";
const REF_A = "0123456789abcdefghjkmnpqrs";
const REF_B = "tvwxyz0123456789abcdefghjk";
const REF_LEAD = "mnpqrstvwxyz0123456789abcd";
const PARTICIPATION = "part-em-1";
const UNRELATED = "part-em-2";
const PROJECT_1 = "proj-em-1";
const PROJECT_2 = "proj-em-2";
const PROJECT_ARCHIVED = "proj-em-archived";
const PROJECT_OTHER = "proj-em-other";

const db = vi.hoisted(() => ({ current: undefined as Firestore | undefined }));

// Only the database accessor is routed to the emulator; the production write path runs unchanged.
vi.mock("../../../lib/firebase/admin", () => ({
  getFirestoreDb: () => {
    if (db.current === undefined) throw new Error("emulator database not initialised");
    return db.current;
  },
  getAdminAuth: () => {
    throw new Error("auth is not used by the emulator suite");
  },
}));

const ALL_DOCS = {
  teams: [TEAM, OTHER_TEAM],
  memberships: [membershipDocId(LEAD_UID, TEAM), membershipDocId(MEMBER_A_UID, TEAM), membershipDocId(MEMBER_B_UID, TEAM)],
  projects: [PROJECT_1, PROJECT_2, PROJECT_ARCHIVED, PROJECT_OTHER],
  participations: [PARTICIPATION, UNRELATED],
};

function timestamp() {
  return new Date("2026-05-01T09:00:00Z");
}

function project(extra: Record<string, unknown> = {}) {
  return {
    teamId: TEAM,
    title: "Synthetisk prosjekt",
    startDate: "2026-06-01",
    endDate: "2026-12-31",
    lifecycleStatus: "planned",
    priority: "medium",
    archived: false,
    archivedAt: null,
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...extra,
  };
}

/** Seeds one team with a lead and two members, three projects (one archived), and two participations of member A and B. */
async function seed(database: Firestore): Promise<void> {
  // Business content is sealed on write (encrypted-only collections); plaintext fixtures would be unreadable by the app.
  await database.collection("teams").doc(TEAM).set(toPersistedTeam(TEAM, { name: "Synthetisk team", status: "active" }));
  await database.collection("teams").doc(OTHER_TEAM).set(toPersistedTeam(OTHER_TEAM, { name: "Synthetisk annet team", status: "active" }));
  const memberships: Array<[uid: string, memberRef: string, role: "teamadmin" | "member"]> = [
    [LEAD_UID, REF_LEAD, "teamadmin"],
    [MEMBER_A_UID, REF_A, "member"],
    [MEMBER_B_UID, REF_B, "member"],
  ];
  for (const [uid, memberRef, role] of memberships) {
    await database
      .collection("teamMemberships")
      .doc(membershipDocId(uid, TEAM))
      .set({ uid, teamId: TEAM, memberRef, role, createdAt: timestamp() });
  }
  await database.collection("teamProjects").doc(PROJECT_1).set(toPersistedTeamProject(PROJECT_1, project({ title: "Demo – Leveranse" })));
  await database.collection("teamProjects").doc(PROJECT_2).set(toPersistedTeamProject(PROJECT_2, project({ title: "Observerbarhet" })));
  await database
    .collection("teamProjects")
    .doc(PROJECT_ARCHIVED)
    .set(toPersistedTeamProject(PROJECT_ARCHIVED, project({ archived: true, archivedAt: timestamp() })));
  await database.collection("teamProjects").doc(PROJECT_OTHER).set(toPersistedTeamProject(PROJECT_OTHER, project({ teamId: OTHER_TEAM })));
  await database.collection("teamProjectParticipations").doc(PARTICIPATION).set(
    toPersistedParticipation(PARTICIPATION, {
      teamId: TEAM,
      projectId: PROJECT_1,
      memberRef: REF_A,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      note: "Første fase",
      archived: false,
    }),
  );
  await database.collection("teamProjectParticipations").doc(UNRELATED).set(
    toPersistedParticipation(UNRELATED, {
      teamId: TEAM,
      projectId: PROJECT_2,
      memberRef: REF_A,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      archived: false,
    }),
  );
}

async function reset(database: Firestore): Promise<void> {
  await Promise.all([
    ...ALL_DOCS.teams.map((id) => database.collection("teams").doc(id).delete()),
    ...ALL_DOCS.memberships.map((id) => database.collection("teamMemberships").doc(id).delete()),
    ...ALL_DOCS.projects.map((id) => database.collection("teamProjects").doc(id).delete()),
    ...ALL_DOCS.participations.map((id) => database.collection("teamProjectParticipations").doc(id).delete()),
  ]);
}

async function readParticipation(database: Firestore, id: string) {
  const snapshot = await database.collection("teamProjectParticipations").doc(id).get();
  // The stored note is a sealed envelope: open it so assertions compare the business value, not the ciphertext.
  return snapshot.exists ? openParticipationDocument(id, snapshot.data() ?? {}) : undefined;
}

async function countTeamParticipations(database: Firestore): Promise<number> {
  const snapshot = await database.collection("teamProjectParticipations").where("teamId", "==", TEAM).get();
  return snapshot.size;
}

/** The write dependencies for one caller: the verified uid and the real transaction store (the production default). */
function deps(uid: string, newParticipationId = "part-em-never-used") {
  return {
    verifyToken: vi.fn().mockResolvedValue({ uid, email: `${uid}@example.test`, email_verified: true }),
    isSuperadmin: async () => false,
    newParticipationId: () => newParticipationId,
  };
}

describe.skipIf(!CONFIGURED)("participation reassignment on the real Firestore Emulator", () => {
  let app: App | undefined;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID as string }, APP_NAME);
    database = getFirestore(app);
    db.current = database;
  });

  beforeEach(async () => {
    await reset(database);
    await seed(database);
  });

  afterAll(async () => {
    await reset(database);
    db.current = undefined;
    if (app !== undefined) await deleteApp(app);
  });

  it("reassigns member and project in place: same document, the new values, and the unrelated record untouched", async () => {
    const before = await readParticipation(database, PARTICIPATION);
    const countBefore = await countTeamParticipations(database);
    const unrelatedBefore = await readParticipation(database, UNRELATED);

    const result = await writeProjectParticipation(
      "token",
      TEAM,
      PROJECT_1,
      "update",
      PARTICIPATION,
      { memberRef: REF_B, projectId: PROJECT_2, startDate: "2026-07-01", endDate: "2026-07-15" },
      deps(LEAD_UID),
    );

    expect(result).toMatchObject({ ok: true, participation: { participationId: PARTICIPATION, memberRef: REF_B, projectId: PROJECT_2 } });
    expect(await readParticipation(database, PARTICIPATION)).toMatchObject({
      teamId: TEAM,
      memberRef: REF_B,
      projectId: PROJECT_2,
      startDate: "2026-07-01",
      endDate: "2026-07-15",
      note: "Første fase",
      archived: false,
    });
    expect(await countTeamParticipations(database)).toBe(countBefore);
    expect(await readParticipation(database, UNRELATED)).toEqual(unrelatedBefore);
    expect(before?.projectId).toBe(PROJECT_1);
  });

  it("refuses a reassignment to another team's project and leaves the stored record exactly as it was", async () => {
    const before = await readParticipation(database, PARTICIPATION);

    const result = await writeProjectParticipation("token", TEAM, PROJECT_1, "update", PARTICIPATION, { projectId: PROJECT_OTHER }, deps(LEAD_UID));

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(await readParticipation(database, PARTICIPATION)).toEqual(before);
  });

  it("refuses a plain member's reassignment and writes nothing", async () => {
    const before = await readParticipation(database, PARTICIPATION);

    const result = await writeProjectParticipation("token", TEAM, PROJECT_1, "update", PARTICIPATION, { memberRef: REF_B }, deps(MEMBER_A_UID));

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(await readParticipation(database, PARTICIPATION)).toEqual(before);
  });

  it("leaves one complete record when two reassignments of the same record race: never a mix of both", async () => {
    const first = { memberRef: REF_B, projectId: PROJECT_2, startDate: "2026-07-01", endDate: "2026-07-15" };
    const second = { memberRef: REF_A, projectId: PROJECT_2, startDate: "2026-08-01", endDate: "2026-08-20" };
    const countBefore = await countTeamParticipations(database);

    const [a, b] = await Promise.all([
      writeProjectParticipation("token", TEAM, PROJECT_1, "update", PARTICIPATION, first, deps(LEAD_UID)),
      writeProjectParticipation("token", TEAM, PROJECT_1, "update", PARTICIPATION, second, deps(LEAD_UID)),
    ]);

    // Both writers were sent the same route project. The one that commits second sees a stored project that no longer
    // matches the route, so it is refused as not_found (a stale view). Exactly one reassignment wins.
    const outcomes = [a, b];
    const winners = outcomes.filter((result) => result.ok);
    const losers = outcomes.filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([{ ok: false, error: "not_found" }]);

    const winnerPayload = a.ok ? first : second;
    const stored = await readParticipation(database, PARTICIPATION);
    expect(stored).toMatchObject({
      memberRef: winnerPayload.memberRef,
      projectId: PROJECT_2,
      startDate: winnerPayload.startDate,
      endDate: winnerPayload.endDate,
      note: "Første fase",
    });
    expect(await countTeamParticipations(database)).toBe(countBefore);
  });

  it("never leaves a reassigned record on an archived project when a reassignment races a project archive", async () => {
    // The archive is a direct write of the project document, as the project write path does. Either serial order is valid;
    // the stored record must agree with whichever order the transaction saw.
    const archive = database.collection("teamProjects").doc(PROJECT_2).update({ archived: true, archivedAt: timestamp() });
    const move = writeProjectParticipation("token", TEAM, PROJECT_1, "update", PARTICIPATION, { projectId: PROJECT_2 }, deps(LEAD_UID));

    const [, result] = await Promise.all([archive, move]);
    const stored = await readParticipation(database, PARTICIPATION);

    if (result.ok) {
      expect(stored?.projectId).toBe(PROJECT_2);
    } else {
      expect(result).toEqual({ ok: false, error: "project_archived" });
      expect(stored?.projectId).toBe(PROJECT_1);
    }
    expect(await countTeamParticipations(database)).toBe(2);
  });
});

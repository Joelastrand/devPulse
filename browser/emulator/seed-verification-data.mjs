// Synthetic fixture seeder for the LOCAL Firebase emulators only (browser verification).
// Refuses to run unless both emulator hosts are localhost and the project id starts with "demo-".
// Never reads .env.local, never uses service-account credentials, and never writes to a real project.
// Run after `firebase emulators:start --config firebase.emulator.json --project demo-devpulse-verify --only auth,firestore`.
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT_ID = "demo-devpulse-verify";
const LOCAL = /^(localhost|127\.0\.0\.1):\d{2,5}$/;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "";

if (!LOCAL.test(firestoreHost) || !LOCAL.test(authHost)) {
  console.error("REFUSED: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must both be localhost emulator hosts.");
  process.exit(1);
}
if (!PROJECT_ID.startsWith("demo-")) {
  console.error("REFUSED: project id must be a demo- project.");
  process.exit(1);
}

// Synthetic accounts only. The password exists only in the local emulator and is not a real credential.
const PASSWORD = "verify-only-synthetic-1";
const ACTOR = "uid-seed-actor";
const TEAM_ID = "team-verify-a";
const USERS = [
  { uid: "uid-verify-teamadmin", email: "teamadmin@verify.test", displayName: "Syntetisk Teamadmin", memberRef: "00000000000000000000000001", role: "teamadmin" },
  { uid: "uid-verify-member-1", email: "member1@verify.test", displayName: "Syntetisk Medlem 1", memberRef: "00000000000000000000000002" },
  { uid: "uid-verify-member-2", email: "member2@verify.test", displayName: "Syntetisk Medlem 2", memberRef: "00000000000000000000000003" },
];

const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

async function ensureUser(u) {
  try {
    await auth.getUserByEmail(u.email);
    await auth.updateUser((await auth.getUserByEmail(u.email)).uid, { password: PASSWORD, displayName: u.displayName });
  } catch {
    await auth.createUser({ uid: u.uid, email: u.email, password: PASSWORD, displayName: u.displayName, emailVerified: true });
  }
}

const now = Timestamp.fromDate(new Date("2026-01-05T09:00:00Z"));

const projects = [
  { projectId: "project-roadmap-1", title: "Syntetisk prosjekt A", startDate: "2026-02-02", endDate: "2026-04-30", lifecycleStatus: "planned", priority: "high", archived: false },
  { projectId: "project-roadmap-2", title: "Syntetisk prosjekt B", startDate: "2026-03-01", endDate: "2026-07-15", lifecycleStatus: "planned", priority: "medium", archived: false },
  { projectId: "project-roadmap-3", title: "Syntetisk prosjekt C", startDate: "2025-11-03", endDate: "2026-01-20", lifecycleStatus: "completed", priority: "low", archived: false },
  { projectId: "project-roadmap-4", title: "Syntetisk prosjekt D", startDate: "2026-10-15", endDate: "2027-02-20", lifecycleStatus: "planned", priority: "high", archived: false },
  { projectId: "project-roadmap-5", title: "Syntetisk prosjekt E", startDate: "2026-12-01", endDate: "2027-03-31", lifecycleStatus: "planned", priority: "medium", archived: false },
];

const participations = [
  { participationId: "part-1", projectId: "project-roadmap-1", memberRef: "00000000000000000000000002", startDate: "2026-02-02", endDate: "2026-03-31", note: "Syntetisk notat" },
  { participationId: "part-2", projectId: "project-roadmap-2", memberRef: "00000000000000000000000003", startDate: "2026-03-01", endDate: "2026-06-30" },
  { participationId: "part-3", projectId: "project-roadmap-4", memberRef: "00000000000000000000000002", startDate: "2026-10-15", endDate: "2027-02-20" },
];

for (const u of USERS) await ensureUser(u);

await db.collection("teams").doc(TEAM_ID).set({
  teamId: TEAM_ID,
  name: "Syntetisk verifikasjonsteam",
  status: "active",
  createdAt: now,
  createdBy: ACTOR,
  visibility: "members",
});

for (const u of USERS) {
  await db.collection("teamMemberships").doc(`${u.uid}__${TEAM_ID}`).set({
    uid: u.uid,
    teamId: TEAM_ID,
    createdAt: now,
    createdVia: "admin_direct",
    grantedBy: ACTOR,
    memberRef: u.memberRef,
    ...(u.role ? { role: u.role, roleUpdatedAt: now, roleUpdatedBy: ACTOR } : {}),
  });
}

for (const p of projects) {
  const { projectId, ...fields } = p;
  await db.collection("teamProjects").doc(projectId).set({ ...fields, teamId: TEAM_ID });
}

for (const p of participations) {
  const { participationId, ...fields } = p;
  await db.collection("teamProjectParticipations").doc(participationId).set({ ...fields, teamId: TEAM_ID, archived: false });
}

// Competence fixtures: synthetic skill trees (catalog), team competence areas, development plans, the team's
// collaborative profile mode and team-entered collaborative levels. No member ratings are written.
const trees = [
  { treeId: "verify-tree-testing", name: "Syntetisk – Testautomatisering", labels: ["Manuell testing", "Enhetstester", "Integrasjonstester", "Automatiserte ende-til-ende-tester", "Tester i byggløypa"] },
  { treeId: "verify-tree-observability", name: "Syntetisk – Observerbarhet", labels: ["Grunnleggende logging", "Strukturert logging", "Målinger og dashbord", "Varsling og sporing"] },
  { treeId: "verify-tree-systemdesign", name: "Syntetisk – Systemdesign", labels: ["Enkle tjenester", "Skalerbare løsninger", "Robuste feilhåndteringer", "Arkitekturprinsipper"] },
  { treeId: "verify-tree-integrations", name: "Syntetisk – Integrasjoner", labels: ["Enkle API-kall", "Hendelsesbasert kommunikasjon", "Datadeling"] },
  { treeId: "verify-tree-delivery", name: "Syntetisk – Leveranse", labels: ["Manuell utrulling", "Automatisert bygg", "Automatisert utrulling til test", "Kontinuerlig levering"] },
  { treeId: "verify-tree-secure-dev", name: "Syntetisk – Sikker utvikling", labels: ["Kodegjennomgang", "Avhengighetskontroll", "Sikkerhetstesting i byggløypa"] },
];

for (const t of trees) {
  await db.collection("skillTrees").doc(t.treeId).set({
    name: t.name,
    nodes: t.labels.map((label, index) => ({ nodeId: `node-${index}`, label, order: index })),
    createdAt: now,
    createdBy: ACTOR,
  });
}

// Six active competence areas in a fixed display order (the team's Kompetanseområder).
const areaTreeIds = trees.map((t) => t.treeId);
for (const [index, treeId] of areaTreeIds.entries()) {
  await db.collection("teamCompetenceAreas").doc(`${TEAM_ID}__${treeId}`).set({
    teamId: TEAM_ID,
    treeId,
    status: "active",
    sortOrder: index,
    createdAt: now,
    updatedAt: now,
  });
}

const planUpdated = Timestamp.fromDate(new Date("2026-10-20T09:00:00Z"));
const plans = [
  {
    treeId: "verify-tree-testing", targetStage: 4, priority: "high",
    milestones: [
      { id: "ms-test-1", title: "Automatisert testkjøring i hovedflyten", targetDate: "2026-12-15", status: "completed" },
      { id: "ms-test-2", title: "Felles testrammeverk for integrasjonstester", targetDate: "2027-01-31", status: "in_progress" },
      { id: "ms-test-3", title: "Ende-til-ende-tester for kritiske flyter", targetDate: "2027-03-31", status: "planned" },
    ],
  },
  {
    treeId: "verify-tree-observability", targetStage: 3, priority: "medium",
    milestones: [
      { id: "ms-obs-1", title: "Felles loggingsstandard", targetDate: "2027-01-15", status: "planned" },
      { id: "ms-obs-2", title: "Varsling for kritiske tjenester", targetDate: "2027-03-01", status: "planned" },
    ],
  },
  {
    treeId: "verify-tree-systemdesign", targetStage: 3, priority: "medium",
    milestones: [
      { id: "ms-sys-1", title: "Arkitekturprinsipper godkjent", targetDate: "2026-12-01", status: "completed" },
      { id: "ms-sys-2", title: "Designgjennomgang for nye tjenester", targetDate: "2027-02-15", status: "in_progress" },
      { id: "ms-sys-3", title: "Skaleringstest av kjerneløsning", targetDate: "2027-04-30", status: "planned" },
    ],
  },
  {
    treeId: "verify-tree-integrations", targetStage: 2, priority: "low",
    milestones: [{ id: "ms-int-1", title: "Felles datadelingsmodell", targetDate: "2027-03-31", status: "planned" }],
  },
];

for (const p of plans) {
  await db.collection("teamCompetencePlans").doc(`${TEAM_ID}__${p.treeId}`).set({
    teamId: TEAM_ID,
    treeId: p.treeId,
    targetStage: p.targetStage,
    priority: p.priority,
    archived: false,
    milestones: p.milestones,
    createdAt: now,
    updatedAt: planUpdated,
  });
}

await db.collection("teamProfileSettings").doc(TEAM_ID).set({ teamId: TEAM_ID, mode: "collaborative", updatedAt: planUpdated });

// Team-entered collaborative levels (one integer 1–4 per area). Not member assessments.
const collaborativeLevels = { "verify-tree-testing": 3, "verify-tree-observability": 2, "verify-tree-systemdesign": 2, "verify-tree-integrations": 1, "verify-tree-delivery": 3, "verify-tree-secure-dev": 2 };
for (const [treeId, level] of Object.entries(collaborativeLevels)) {
  await db.collection("teamCollaborativeLevels").doc(`${TEAM_ID}__${treeId}`).set({ teamId: TEAM_ID, treeId, level, updatedAt: planUpdated });
}

console.log(`Seeded synthetic emulator data for ${PROJECT_ID}: ${USERS.length} users, 1 team, ${projects.length} projects, ${participations.length} participations, ${trees.length} skill trees, ${areaTreeIds.length} competence areas, ${plans.length} plans, ${Object.keys(collaborativeLevels).length} collaborative levels.`);

// Synthetic demonstration data for the existing team `demo-team` ("Demoteam").
//
// Dry-run by default. Writes only with BOTH `--write` and
// `--confirm=<projectId>:demo-team`. Never deletes, never overwrites existing
// records (creates are create-only; the owner's skill levels get missing keys
// merged in), never touches superadmin records, and never writes anything for a
// uid that has an erasure record.
//
// Usage:
//   node scripts/seed-demoteam.mjs --project=devpulse-ac26e            (dry run)
//   node scripts/seed-demoteam.mjs --project=devpulse-ac26e --write --confirm=devpulse-ac26e:demo-team

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../package.json", import.meta.url));
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const TARGET_PROJECT = "devpulse-ac26e";
const TEAM_ID = "demo-team";
const TEAM_NAME = "Demoteam";
const OWNER_UID = "GG0zEj9mPNMXFzQdicKdEgKQMsN2";
const AUDIT = "demo-seed";
const SYNTH_UID_PREFIX = "demoteam-synth-";
const ENV_FILE = new URL("../.env.local", import.meta.url);

// Fixed timestamps keep reruns byte-identical.
const T_CREATED = new Date("2026-11-06T09:00:00.000Z");
const T_CONSENT = new Date("2026-11-02T12:00:00.000Z");
const T_ASSESSED = new Date("2026-11-04T12:00:00.000Z");

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a === name || a.startsWith(`${name}=`));
const flagValue = (name) => {
  const f = flag(name);
  return f === undefined ? undefined : f.includes("=") ? f.slice(name.length + 1) : "";
};
const WRITE = argv.includes("--write");
const projectArg = flagValue("--project");
const confirmArg = flagValue("--confirm");

function fail(message) {
  console.error(`Aborted: ${message} (nothing was written)`);
  process.exit(1);
}

if (projectArg !== TARGET_PROJECT) fail("--project must be devpulse-ac26e");
if (WRITE && confirmArg !== `${TARGET_PROJECT}:${TEAM_ID}`) fail("--write requires --confirm=devpulse-ac26e:demo-team");

// ---------------------------------------------------------------------------
// Env (values never printed)
// ---------------------------------------------------------------------------

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const env = {};
for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
if (env.FIREBASE_PROJECT_ID !== TARGET_PROJECT) fail("env project does not match the target");

const app = initializeApp(
  {
    credential: cert({
      projectId: TARGET_PROJECT,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.split(BS + "n").join(NL).trim(),
    }),
    projectId: TARGET_PROJECT,
  },
  "seed-demoteam",
);
const db = getFirestore(app);
const auth = getAuth(app);

// ---------------------------------------------------------------------------
// Deterministic ids
// ---------------------------------------------------------------------------

function uuidFrom(name) {
  const h = createHash("sha1").update(`devpulse-demoteam:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const MEMBER_REF_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
function memberRefFrom(name) {
  const bytes = createHash("sha256").update(`devpulse-demoteam-ref:${name}`).digest();
  let out = "";
  for (let i = 0; i < 26; i += 1) out += MEMBER_REF_ALPHABET[bytes[i] % 32];
  return out;
}

// ---------------------------------------------------------------------------
// Synthetic content
// ---------------------------------------------------------------------------

// Synthetic members. `consent`: explicit team-specific sharing (noticeVersion 1).
// `levels`: self-assessed levels (1-4) keyed by treeId. Members 07 and 08 do not consent.
const MEMBERS = [
  { n: "01", name: "Ingrid Solberg", consent: true, levels: { "demo-skill-delivery": 4, "demo-skill-observability": 3, "demo-skill-secure-dev": 3, "demoteam-typescript-frontend": 4, "demoteam-cloud-platform": 2, "demoteam-appsec": 3, "demoteam-test-automation": 4 } },
  { n: "02", name: "Erik Dahl", consent: true, levels: { "demo-skill-delivery": 3, "demo-skill-observability": 2, "demo-skill-secure-dev": 4, "demo-skill-testing": 2, "demoteam-backend-api": 3, "demoteam-appsec": 2, "demoteam-test-automation": 3 } },
  { n: "03", name: "Kari Hansen", consent: true, levels: { "demo-skill-delivery": 3, "demo-skill-observability": 3, "demo-skill-secure-dev": 2, "demo-skill-testing": 3, "demoteam-backend-api": 4, "demoteam-appsec": 3, "demoteam-system-architecture": 3, "demoteam-test-automation": 2, "demoteam-typescript-frontend": 2 } },
  { n: "04", name: "Magnus Berg", consent: true, levels: { "demo-skill-delivery": 4, "demo-skill-secure-dev": 3, "demoteam-backend-api": 3, "demoteam-cloud-platform": 3, "demoteam-test-automation": 2, "demoteam-typescript-frontend": 3 } },
  { n: "05", name: "Sara Nilsen", consent: true, levels: { "demo-skill-delivery": 2, "demo-skill-secure-dev": 3, "demoteam-backend-api": 3, "demoteam-system-architecture": 4, "demoteam-test-automation": 3, "demoteam-typescript-frontend": 3 } },
  { n: "06", name: "Jonas Haugen", consent: true, levels: { "demo-skill-secure-dev": 4, "demoteam-backend-api": 4, "demoteam-cloud-platform": 3, "demoteam-test-automation": 3, "demoteam-typescript-frontend": 4 } },
  { n: "07", name: "Mari Eriksen", consent: false, levels: {} },
  { n: "08", name: "Ole Kristiansen", consent: false, levels: { "demoteam-typescript-frontend": 2, "demoteam-appsec": 4 } },
];

// Team-owned skill trees: four existing demo trees (kept) plus six new catalog areas.
const NEW_TREES = [
  { treeId: "demoteam-typescript-frontend", name: "Demo – TypeScript og frontend", labels: ["Grunnleggende TypeScript", "Komponentbasert utvikling", "Typesikre API-klienter", "Tilgjengelighet og ytelse", "Veiledning av andre"] },
  { treeId: "demoteam-backend-api", name: "Demo – Backend og API-design", labels: ["REST-grunnlag", "Datamodellering", "Versjonering av API", "Feilhåndtering og idempotens", "Designe for drift"] },
  { treeId: "demoteam-cloud-platform", name: "Demo – Skyplattformer", labels: ["Konsoll og grunnoppsett", "Infrastruktur som kode", "Nettverk og tilgang", "Kostnad og kapasitet"] },
  { treeId: "demoteam-appsec", name: "Demo – Applikasjonssikkerhet", labels: ["Sikker kodingspraksis", "Autentisering og autorisasjon", "Hemmelighetshåndtering", "Sårbarhetsstyring", "Sikkerhetsreview"] },
  { treeId: "demoteam-test-automation", name: "Demo – Testautomatisering", labels: ["Enhetstester", "Komponenttester", "E2E-tester", "Testdata og miljø", "Flaky-håndtering"] },
  { treeId: "demoteam-system-architecture", name: "Demo – Systemarkitektur", labels: ["Domenemodellering", "Arkitekturbeslutninger", "Integrasjonsmønstre", "Kapasitetsplanlegging"] },
];

// Team skill needs (coverage requirements) for the team.
const NEEDS = [
  { treeId: "demoteam-typescript-frontend", requiredLevel: 3, requiredCoverage: 4 },
  { treeId: "demoteam-backend-api", requiredLevel: 3, requiredCoverage: 3 },
  { treeId: "demoteam-appsec", requiredLevel: 3, requiredCoverage: 4 },
  { treeId: "demoteam-test-automation", requiredLevel: 3, requiredCoverage: 6 },
  { treeId: "demoteam-cloud-platform", requiredLevel: 2, requiredCoverage: 3 },
  { treeId: "demoteam-system-architecture", requiredLevel: 3, requiredCoverage: 2 },
];

// Owner levels to merge in (missing keys only; existing owner levels are never changed).
const OWNER_LEVEL_MERGE = {
  "demoteam-typescript-frontend": 3,
  "demoteam-backend-api": 3,
  "demoteam-cloud-platform": 2,
  "demoteam-appsec": 2,
  "demoteam-test-automation": 3,
  "demoteam-system-architecture": 2,
};

// Competence plans (team capability development), keyed teamId__treeId.
const PLANS = [
  { treeId: "demoteam-typescript-frontend", targetStage: 3, priority: "high", milestones: [
    ["Gjennomgå TypeScript-retningslinjer for teamet", "2026-09-30", "completed"],
    ["Refaktorere to kjerneskjermer til typesikre komponenter", "2026-12-15", "in_progress"],
    ["Innføre strict-modus i alle frontend-pakker", "2027-03-31", "planned"],
  ] },
  { treeId: "demoteam-appsec", targetStage: 3, priority: "high", milestones: [
    ["Kjøre trusselmodellering for to nye tjenester", "2026-10-31", "completed"],
    ["Innføre hemmelighetsskanning i byggløypa", "2026-12-31", "in_progress"],
    ["Gjennomføre sikkerhetsreview av autentisering", "2027-02-28", "planned"],
    ["Etablere rutine for sårbarhetsoppfølging", "2027-05-31", "planned"],
  ] },
  { treeId: "demoteam-test-automation", targetStage: 3, priority: "medium", milestones: [
    ["Stabilisere regresjonssuiten (færre flaky-tester)", "2026-11-30", "in_progress"],
    ["Ta i bruk komponenttester for API-laget", "2027-01-31", "planned"],
    ["Kjøre E2E-tester i hver merge til main", "2027-04-30", "planned"],
  ] },
  { treeId: "demoteam-cloud-platform", targetStage: 2, priority: "medium", milestones: [
    ["Sertifiseringsforberedelse: grunnleggende skyarkitektur", "2026-08-31", "completed"],
    ["Flytte ett tjenestemiljø til infrastruktur som kode", "2027-06-30", "planned"],
  ] },
  { treeId: "demoteam-system-architecture", targetStage: 3, priority: "low", milestones: [
    ["Dokumentere domenemodellen for Kontroll", "2026-12-31", "in_progress"],
    ["Ta arkitekturbeslutninger i ADR-format", "2027-03-31", "planned"],
  ] },
];

// Products (team systems). Kontroll already exists and is kept as-is.
const SYSTEMS = [
  { name: "Varslingstjeneste", description: "Sender varsler ved avvik i driftsdata.", knowledgeMemberRefs: ["01"], attrs: { availability: "god", reliability: "trenger_oppfolging", maintainability: "god", security: "trenger_oppfolging", testability: "kritisk", deployability: "god", observability: "god" } },
  { name: "Kunnskapsportal", description: "Intern portal for dokumentasjon og onboarding.", knowledgeMemberRefs: ["03"], attrs: { availability: "god", reliability: "god", maintainability: "kritisk", security: "trenger_oppfolging", testability: "ikke_vurdert", deployability: "god", observability: "trenger_oppfolging" } },
];

// Projects. `productId` is deliberately NOT written: the stored-project parser rejects it.
const PROJECTS = [
  { key: "p1", title: "Migrer varsling til ny plattform", startDate: "2026-05-04", endDate: "2026-09-30", lifecycleStatus: "completed", priority: "high" },
  { key: "p2", title: "Oppgrader autentisering i Kontroll", startDate: "2026-03-02", endDate: "2026-08-14", lifecycleStatus: "completed", priority: "medium" },
  { key: "p3", title: "Automatiser regresjonstester", startDate: "2026-09-01", endDate: "2027-02-28", lifecycleStatus: "planned", priority: "high" },
  { key: "p4", title: "Innfør trusselmodellering for nye tjenester", startDate: "2026-10-01", endDate: "2027-03-31", lifecycleStatus: "planned", priority: "medium" },
  { key: "p5", title: "Kunnskapsportal v2", startDate: "2027-01-11", endDate: "2027-06-30", lifecycleStatus: "planned", priority: "medium" },
  { key: "p6", title: "Ny rapporteringsløsning", startDate: "2027-04-01", endDate: "2027-08-31", lifecycleStatus: "planned", priority: "low" },
];

// Participations: non-overlapping per member (checked below).
const PARTICIPATIONS = [
  ["01", "p1", "2026-05-04", "2026-09-30"], ["01", "p4", "2026-10-01", "2027-03-31"],
  ["02", "p1", "2026-05-04", "2026-09-30"], ["02", "p3", "2026-10-15", "2027-02-28"],
  ["03", "p2", "2026-03-02", "2026-08-14"], ["03", "p5", "2027-01-11", "2027-06-30"],
  ["04", "p3", "2026-09-01", "2027-02-28"],
  ["05", "p4", "2026-10-01", "2027-03-31"], ["05", "p6", "2027-04-01", "2027-08-31"],
  ["06", "p5", "2027-01-11", "2027-06-30"],
  ["07", "p2", "2026-03-02", "2026-08-14"],
  ["08", "p1", "2026-05-04", "2026-09-30"],
  ["owner", "p2", "2026-03-02", "2026-08-14"], ["owner", "p4", "2026-10-01", "2027-03-31"], ["owner", "p6", "2027-04-01", "2027-08-31"],
];

// Owner's synthetic personal goals (userDevelopment/{owner}/goals).
const OWNER_GOALS = [
  { key: "01", title: "Bli sikker på trusselmodellering i nye tjenester", treeId: "demo-skill-secure-dev", targetDate: "2027-03-31", status: "active" },
  { key: "02", title: "Automatisere utrulling til test", treeId: "demo-skill-delivery", targetDate: "2027-01-31", status: "active" },
  { key: "03", title: "Forbedre observerbarheten i Kontroll", treeId: "demo-skill-observability", targetDate: "2027-05-31", status: "active" },
  { key: "04", title: "Mentorere to nye teammedlemmer", targetDate: "2027-06-30", status: "active" },
  { key: "05", title: "Fullføre grunnleggende logging", treeId: "demo-skill-observability", status: "completed", completedAt: new Date("2026-09-15T10:00:00.000Z") },
  { key: "06", title: "Sette opp enhetstester i byggløypa", treeId: "demo-skill-testing", status: "completed", completedAt: new Date("2026-10-20T10:00:00.000Z") },
];

// Organizational roles: a title and a description only (role-profiles SPEC). No skill requirements, no target role.
const ROLES = [
  { roleId: "demoteam-role-senior-dev", name: "Demo – Senior utvikler", description: "Syntetisk rolleprofil for demonstrasjon." },
  { roleId: "demoteam-role-architect", name: "Demo – Arkitekt", description: "Syntetisk rolleprofil for demonstrasjon." },
];

// Sanity: participations must not overlap for one member.
(function assertNoOverlap() {
  const byMember = new Map();
  for (const [m, , s, e] of PARTICIPATIONS) {
    const list = byMember.get(m) ?? [];
    for (const [s2, e2] of list) if (s <= e2 && s2 <= e) fail(`overlapping participations for member ${m}`);
    list.push([s, e]);
    byMember.set(m, list);
  }
})();

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

const ops = []; // { collection, id, path, action, data?, update? }
const add = (collection, id, data) => ops.push({ collection, id, path: `${collection}/${id}`, data });

const memberUid = (n) => `${SYNTH_UID_PREFIX}${n}`;
const memberRefOfN = (n) => memberRefFrom(`${TEAM_ID}:${n}`);

// Auth + profile + membership per synthetic member
for (const m of MEMBERS) {
  const uid = memberUid(m.n);
  ops.push({ kind: "auth", uid, displayName: m.name, path: `auth/${uid}` });
  add("userProfiles", uid, { displayName: m.name, createdAt: T_CREATED, updatedAt: T_CREATED });
  const membership = {
    uid,
    teamId: TEAM_ID,
    createdAt: T_CREATED,
    createdVia: "admin_direct",
    grantedBy: AUDIT,
    memberRef: memberRefOfN(m.n),
  };
  if (m.consent) membership.skillContribution = { noticeVersion: 1, consentedAt: T_CONSENT };
  add("teamMemberships", `${uid}__${TEAM_ID}`, membership);
  if (Object.keys(m.levels).length > 0) {
    add("skillProfiles", uid, { levels: m.levels, createdAt: T_CREATED, updatedAt: T_CREATED });
  }
}

// Skill trees (team catalog areas)
for (const t of NEW_TREES) {
  add("skillTrees", t.treeId, {
    name: t.name,
    nodes: t.labels.map((label, i) => ({ nodeId: `node-${i}`, label, order: i })),
    createdAt: T_CREATED,
    createdBy: AUDIT,
  });
}

// Coverage needs
for (const n of NEEDS) {
  add("teamSkillNeeds", `${TEAM_ID}__${n.treeId}`, { teamId: TEAM_ID, treeId: n.treeId, requiredLevel: n.requiredLevel, requiredCoverage: n.requiredCoverage, createdAt: T_CREATED, updatedAt: T_CREATED });
}

// Competence plans
for (const p of PLANS) {
  const PLAN_TITLES = {"demoteam-appsec":"Applikasjonssikkerhet","demoteam-cloud-platform":"Skyplattformer","demoteam-system-architecture":"Systemarkitektur","demoteam-test-automation":"Testautomatisering","demoteam-typescript-frontend":"TypeScript og frontend"};
  add("teamCompetencePlans", uuidFrom(`plan-doc:${TEAM_ID}:${p.treeId}`), {
    teamId: TEAM_ID,
    title: PLAN_TITLES[p.treeId],
    treeId: null,
    targetStage: p.targetStage,
    priority: p.priority,
    archived: false,
    milestones: p.milestones.map(([title, targetDate, status], i) => ({ id: uuidFrom(`plan:${p.treeId}:${i}`), title, targetDate, status })),
    createdAt: T_CREATED,
    updatedAt: T_CREATED,
  });
}

// Products
SYSTEMS.forEach((s, i) => {
  const systemId = uuidFrom(`system:${s.name}`);
  const assessed = (value) => ({ value, note: null, assessedAt: T_ASSESSED, assessedBy: AUDIT });
  const data = {
    systemId,
    teamId: TEAM_ID,
    name: s.name,
    description: s.description,
    backstageUrl: null,
    knowledgeMemberRefs: s.knowledgeMemberRefs.map(memberRefOfN),
    createdAt: T_CREATED,
    createdBy: AUDIT,
    updatedAt: T_CREATED,
    updatedBy: AUDIT,
  };
  for (const [attr, value] of Object.entries(s.attrs)) data[attr] = assessed(value);
  add("teamSystems", systemId, data);
});

// Projects (ids are deterministic; productId is never written)
const projectIds = {};
for (const p of PROJECTS) {
  const projectId = uuidFrom(`project:${p.key}:${p.title}`);
  projectIds[p.key] = projectId;
  add("teamProjects", projectId, {
    teamId: TEAM_ID,
    title: p.title,
    startDate: p.startDate,
    endDate: p.endDate,
    lifecycleStatus: p.lifecycleStatus,
    priority: p.priority,
    archived: false,
    archivedAt: null,
    createdAt: T_CREATED,
    updatedAt: T_CREATED,
  });
}

// Participations
for (const [m, projKey, startDate, endDate] of PARTICIPATIONS) {
  const participationId = uuidFrom(`participation:${m}:${projKey}`);
  add("teamProjectParticipations", participationId, {
    teamId: TEAM_ID,
    projectId: projectIds[projKey],
    memberRef: memberRefOfN(m),
    startDate,
    endDate,
    archived: false,
  });
}

// Roles. The owner has no target role and no role assignment is seeded (none is modelled yet).
for (const r of ROLES) {
  add("roleDefinitions", r.roleId, { name: r.name, description: r.description, createdAt: T_CREATED, createdBy: AUDIT, updatedAt: T_CREATED, updatedBy: AUDIT });
}

// Owner display name (roster) and memberRef. The memberRef is set only if absent,
// mirroring materializeMemberRefs (which is superadmin-gated and not callable here).
const OWNER_DISPLAY_NAME = "Joel Åstrand";
add("userProfiles", OWNER_UID, { displayName: OWNER_DISPLAY_NAME, createdAt: T_CREATED, updatedAt: T_CREATED });
ops.push({ kind: "ownerMemberRef", path: `teamMemberships/${OWNER_UID}__${TEAM_ID}`, memberRef: memberRefOfN("owner") });

// Owner goals (create-only; the owner's other goals are never touched)
for (const g of OWNER_GOALS) {
  const id = `demoteam-goal-${g.key}`;
  const data = { title: g.title, status: g.status, createdAt: T_CREATED, updatedAt: T_CREATED };
  if (g.status === "completed") {
    // A completed goal was created before it was completed (completedAt >= createdAt).
    data.createdAt = new Date(g.completedAt.getTime() - 120 * 24 * 60 * 60 * 1000);
    data.updatedAt = g.completedAt;
    data.completedAt = g.completedAt;
  }
  if (g.treeId) data.treeId = g.treeId;
  if (g.targetDate) data.targetDate = g.targetDate;
  ops.push({ kind: "doc", collection: `userDevelopment/${OWNER_UID}/goals`, id, path: `userDevelopment/${OWNER_UID}/goals/${id}`, data });
}

// Owner skill levels: merge missing keys into the existing skillProfiles/{owner} document.
ops.push({ kind: "ownerLevelsMerge", path: `skillProfiles/${OWNER_UID}`, levels: OWNER_LEVEL_MERGE });

// Normalise: `doc` kinds carry collection+id; `add` kinds carry collection+id; keep paths.
const docOps = ops.filter((o) => o.kind === undefined || o.kind === "doc");
const authOps = ops.filter((o) => o.kind === "auth");
const ownerLevelOps = ops.filter((o) => o.kind === "ownerLevelsMerge");

// ---------------------------------------------------------------------------
// Guards and classification (read-only)
// ---------------------------------------------------------------------------

async function guards() {
  const team = await db.collection("teams").doc(TEAM_ID).get();
  if (!team.exists || team.data().name !== TEAM_NAME || team.data().status !== "active") fail("demo-team is not the active Demoteam");
  const sa = await db.collection("superadmins").doc(OWNER_UID).get();
  if (!sa.exists || sa.data().active !== true) fail("owner is not an active superadmin");
  const ownerAuth = await auth.getUser(OWNER_UID).catch(() => null);
  if (!ownerAuth || ownerAuth.email !== "astrand.joel@gmail.com") fail("owner Auth identity does not match");
  const erasure = await db.collection("accountErasures").doc(OWNER_UID).get();
  if (erasure.exists) fail("owner has an erasure record");
  const membership = await db.collection("teamMemberships").doc(`${OWNER_UID}__${TEAM_ID}`).get();
  if (!membership.exists) fail("owner has no Demoteam membership");
  return { ownerLevelsDoc: await db.collection("skillProfiles").doc(OWNER_UID).get() };
}

async function classify(extra) {
  const results = { create: [], skip: [], merge: [], conflictAuth: [] };
  for (const op of docOps) {
    const snap = await db.doc(op.path).get();
    if (snap.exists) results.skip.push(op);
    else results.create.push(op);
  }
  for (const op of authOps) {
    const user = await auth.getUser(op.uid).then(() => true, () => false);
    if (user) results.skip.push(op);
    else results.create.push(op);
  }
  for (const op of ops.filter((o) => o.kind === "ownerMemberRef")) {
    const snap = await db.doc(op.path).get();
    const existing = snap.data()?.memberRef;
    if (existing === undefined) results.merge.push({ ...op, missing: ["memberRef"], levels: {} });
    else if (existing === op.memberRef) results.skip.push(op);
    else fail("owner membership already has a different memberRef; refusing to overwrite");
  }
  const existingLevels = extra.ownerLevelsDoc.exists ? extra.ownerLevelsDoc.data().levels ?? {} : {};
  for (const op of ownerLevelOps) {
    const missing = Object.keys(op.levels).filter((k) => !Object.hasOwn(existingLevels, k));
    op.missing = missing;
    if (!extra.ownerLevelsDoc.exists) fail("owner skillProfile does not exist; refusing to create it here");
    if (missing.length > 0) results.merge.push(op);
    else results.skip.push(op);
  }
  return results;
}

function report(results) {
  const byCollection = (list, key) => {
    const m = {};
    for (const op of list) {
      const c = op.kind === "auth" ? "Firebase Auth users" : op.kind === "ownerLevelsMerge" ? "skillProfiles (owner, merge)" : op.collection;
      m[c] = (m[c] ?? 0) + 1;
    }
    return m;
  };
  console.log(`Target: project ${TARGET_PROJECT}, team ${TEAM_ID} (${TEAM_NAME}), owner uid present (not printed).`);
  console.log(`Mode: ${WRITE ? "WRITE" : "dry-run (no writes)"}`);
  console.log("CREATE:", byCollection(results.create));
  console.log("SKIP (exists, preserved):", byCollection(results.skip));
  console.log("MERGE (owner levels, missing keys only):", results.merge.map((op) => `${op.missing.length} key(s): ${op.missing.join(", ")}`));
  console.log(`Totals: create=${results.create.length} skip=${results.skip.length} merge=${results.merge.length}`);
}

// ---------------------------------------------------------------------------
// Write (create-only; batched)
// ---------------------------------------------------------------------------

async function write(results) {
  for (const op of results.create.filter((o) => o.kind === "auth")) {
    await auth.createUser({ uid: op.uid, displayName: op.displayName, disabled: true });
  }
  const writes = results.create.filter((o) => o.kind !== "auth");
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const op of writes.slice(i, i + 400)) {
      batch.create(db.doc(op.path), op.data);
    }
    await batch.commit();
  }
  for (const op of results.merge.filter((o) => o.kind === "ownerMemberRef")) {
    await db.doc(op.path).update({ memberRef: op.memberRef });
  }
  for (const op of results.merge.filter((o) => o.kind !== "ownerMemberRef")) {
    const update = { updatedAt: new Date() };
    for (const key of op.missing) update[`levels.${key}`] = op.levels[key];
    await db.doc(op.path).update(update);
  }
}

const info = await guards();
const first = await classify({ ownerLevelsDoc: info.ownerLevelsDoc });
report(first);
const dumpPath = flagValue("--dump");
if (dumpPath) {
  // Planned synthetic documents as JSON (no secrets), for offline validation.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(dumpPath, JSON.stringify(first.create.map((o) => ({ path: o.path ?? `auth/${o.uid}`, data: o.data ?? null })), null, 2));
  console.log(`Dumped planned creates to ${dumpPath}`);
}
if (WRITE) {
  await write(first);
  const after = await classify({ ownerLevelsDoc: await db.collection("skillProfiles").doc(OWNER_UID).get() });
  console.log("\nAfter write -> CREATE:", after.create.length, "MERGE:", after.merge.length, "(expect 0, 0)");
}
process.exit(0);

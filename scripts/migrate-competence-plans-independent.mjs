// Moves legacy Kompetanseplan documents to independent plan ids (docs/features/team-experience-redesign, OD-6).
//
// Legacy: teamCompetencePlans/{teamId}__{treeId}, a plan that required a competence area.
// New:    teamCompetencePlans/{randomUUID}, with a team-authored `title` and an optional `treeId` label (kept from the
//         legacy document, never gated on by any read or write).
//
// Dry-run by default: reads and reports only. Writing needs BOTH `--write` and
// `--confirm=<project>:competence-plans-independent`, and a `--backup-dir` that receives the legacy documents first.
// Per plan, the new document and the deletion of the legacy document are one batch, so a rerun never duplicates a plan.
// The title is the catalog label already shown to members for that tree (skillTrees/{treeId}.name), or the tree id.
// Documents whose id does not match their stored teamId and treeId are reported and left untouched.
//
// Usage:
//   node scripts/migrate-competence-plans-independent.mjs --project=devpulse-ac26e                       (dry run)
//   node scripts/migrate-competence-plans-independent.mjs --project=devpulse-ac26e --write \
//     --backup-dir=<empty directory outside the repo> --confirm=devpulse-ac26e:competence-plans-independent

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../package.json", import.meta.url));
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const TARGET_PROJECT = "devpulse-ac26e";
const CONFIRM_SCOPE = "competence-plans-independent";
const PLANS = "teamCompetencePlans";
const TREES = "skillTrees";
const ENV_FILE = new URL("../.env.local", import.meta.url);
const LEGACY_KEYS = ["teamId", "treeId", "targetStage", "priority", "archived", "milestones", "createdAt", "updatedAt"];
const NEW_KEYS = ["teamId", "title", "treeId", "targetStage", "priority", "archived", "milestones", "createdAt", "updatedAt"];

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const f = argv.find((a) => a === name || a.startsWith(`${name}=`));
  return f === undefined ? undefined : f.includes("=") ? f.slice(name.length + 1) : "";
};
const WRITE = argv.includes("--write");
const projectArg = flagValue("--project");
const confirmArg = flagValue("--confirm");
const backupDir = flagValue("--backup-dir");

function fail(message) {
  console.error(`Aborted: ${message} (nothing was written)`);
  process.exit(1);
}

if (projectArg !== TARGET_PROJECT) fail(`--project must be ${TARGET_PROJECT}`);
if (WRITE && confirmArg !== `${TARGET_PROJECT}:${CONFIRM_SCOPE}`) {
  fail(`--write requires --confirm=${TARGET_PROJECT}:${CONFIRM_SCOPE}`);
}
if (WRITE && (!backupDir || !existsSync(backupDir) || readdirSync(backupDir).length > 0)) {
  fail("--write requires --backup-dir pointing at an existing, empty directory outside the repository");
}

const env = {};
for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
if (env.FIREBASE_PROJECT_ID !== TARGET_PROJECT) fail("env project does not match the target");

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const app = initializeApp(
  {
    credential: cert({
      projectId: TARGET_PROJECT,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.split(BS + "n").join(NL).trim(),
    }),
    projectId: TARGET_PROJECT,
  },
  "migrate-competence-plans",
);
const db = getFirestore(app);

const isPlainRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const sameKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));

/** A legacy plan document id is `teamId__treeId`, and both parts must match the stored fields. */
function classify(docId, data) {
  if (!docId.includes("__")) return { kind: "current" };
  if (!isPlainRecord(data) || !sameKeys(data, LEGACY_KEYS)) return { kind: "anomaly", reason: "unexpected_fields" };
  const [teamPart, ...rest] = docId.split("__");
  const treePart = rest.join("__");
  if (data.teamId !== teamPart || data.treeId !== treePart) return { kind: "anomaly", reason: "id_mismatch" };
  return { kind: "legacy" };
}

const snapshot = await db.collection(PLANS).get();
const legacy = [];
const anomalies = [];
let currentCount = 0;
for (const doc of snapshot.docs) {
  const verdict = classify(doc.id, doc.data());
  if (verdict.kind === "legacy") legacy.push(doc);
  else if (verdict.kind === "anomaly") anomalies.push({ docId: doc.id, reason: verdict.reason });
  else currentCount += 1;
}

async function catalogTitle(treeId) {
  const tree = await db.collection(TREES).doc(treeId).get();
  const name = tree.exists ? tree.data()?.name : undefined;
  return typeof name === "string" && name.trim().length > 0 ? name.trim().slice(0, 120) : treeId;
}

const plan = [];
for (const doc of legacy) {
  const data = doc.data();
  plan.push({ legacyId: doc.id, newId: randomUUID(), teamId: data.teamId, title: await catalogTitle(data.treeId), data });
}

console.log(`Project: ${TARGET_PROJECT}  mode: ${WRITE ? "WRITE" : "DRY RUN"}`);
console.log(`Documents: ${snapshot.size} total, ${currentCount} already independent, ${legacy.length} legacy, ${anomalies.length} anomalous (left untouched).`);
for (const entry of plan) {
  console.log(`  would move ${entry.legacyId} -> new plan id for team ${entry.teamId}, title "${entry.title}"`);
}
for (const anomaly of anomalies) console.log(`  anomaly ${anomaly.docId}: ${anomaly.reason} (not migrated, not deleted)`);

if (!WRITE) {
  console.log("Dry run only. Re-run with --write, --backup-dir and --confirm to apply.");
  process.exit(0);
}

// Backup first: a failure here aborts before any document changes.
const backupPath = join(backupDir, "competence-plans-legacy-backup.json");
const backup = legacy.map((doc) => ({
  id: doc.id,
  data: Object.fromEntries(
    Object.entries(doc.data()).map(([k, v]) => [k, v instanceof Timestamp ? v.toDate().toISOString() : v]),
  ),
}));
writeFileSync(backupPath, JSON.stringify(backup, null, 2), { encoding: "utf8", flag: "wx" });
console.log(`Backup written: ${backupPath} (${backup.length} documents)`);

for (const entry of plan) {
  const batch = db.batch();
  const record = {
    teamId: entry.data.teamId,
    title: entry.title,
    treeId: entry.data.treeId,
    targetStage: entry.data.targetStage,
    priority: entry.data.priority,
    archived: entry.data.archived,
    milestones: entry.data.milestones,
    createdAt: entry.data.createdAt,
    updatedAt: entry.data.updatedAt,
  };
  batch.create(db.collection(PLANS).doc(entry.newId), record);
  batch.delete(db.collection(PLANS).doc(entry.legacyId));
  await batch.commit();
}

// Post-verification: no legacy document remains, every new plan has the independent shape, and nothing else moved.
const after = await db.collection(PLANS).get();
const remainingLegacy = after.docs.filter((doc) => doc.id.includes("__")).map((doc) => doc.id);
const newlyWritten = after.docs.filter((doc) => plan.some((p) => p.newId === doc.id));
const shapeOk = newlyWritten.every((doc) => sameKeys(doc.data(), NEW_KEYS));
console.log(`Verification: remaining legacy ${remainingLegacy.length}, new documents ${newlyWritten.length}/${plan.length}, shape ${shapeOk ? "ok" : "FAILED"}.`);
if (remainingLegacy.length > 0 || newlyWritten.length !== plan.length || !shapeOk) {
  console.error("Post-verification failed. Restore from the backup if needed.");
  process.exit(2);
}

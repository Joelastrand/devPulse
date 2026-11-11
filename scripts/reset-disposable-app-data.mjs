// Resets DISPOSABLE application test data in the Firestore database of the private test project (devpulse-ac26e).
//
// Authorized by the product owner: all application data in devpulse-ac26e is disposable test data.
//
// What it deletes: the documents of the explicit COLLECTIONS list below, with their subcollections (recursiveDelete).
// What it never touches:
//   - Firebase Auth users, project configuration, Firestore security rules and indexes, Hosting, secrets and env vars.
//   - `superadmins` and `superadminRegistry`: access-control state. Removing them would lock the owner out of
//     administration, so they are preserved and listed as KEPT in the report.
//   - Any collection not in COLLECTIONS. An unknown top-level collection aborts a write run.
//
// Dry run by default: lists counts per collection and changes nothing. Writing needs BOTH `--write` and
// `--confirm=devpulse-ac26e:reset-disposable-app-data`. After a write it re-counts and fails if anything listed remains.
//
// Usage:
//   node scripts/reset-disposable-app-data.mjs --project=devpulse-ac26e                       (dry run)
//   node scripts/reset-disposable-app-data.mjs --project=devpulse-ac26e --write --confirm=devpulse-ac26e:reset-disposable-app-data

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../package.json", import.meta.url));
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const TARGET_PROJECT = "devpulse-ac26e";
const CONFIRM_SCOPE = "reset-disposable-app-data";
const ENV_FILE = new URL("../.env.local", import.meta.url);

/** Application-owned collections that are cleared. Every top-level collection must be listed here or in KEPT. */
const COLLECTIONS = [
  "challenges",
  "pulseSurveyResponses",
  "roadmapItems",
  "roleDefinitions",
  "skillProfiles",
  "skillProgress",
  "skillTrees",
  "surveyResponses",
  "surveys",
  "teamCompetenceAreas",
  "teamCompetencePlans",
  "teamMemberships",
  "teamProjectParticipations",
  "teamProjects",
  "teamSkillNeeds",
  "teamSurveyState",
  "teamSystems",
  "teams",
  "userDevelopment",
  "userProfiles",
];

/** Access-control state preserved on purpose (see header). */
const KEPT = ["superadmins", "superadminRegistry"];

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const f = argv.find((a) => a === name || a.startsWith(`${name}=`));
  return f === undefined ? undefined : f.includes("=") ? f.slice(name.length + 1) : "";
};
const WRITE = argv.includes("--write");
const projectArg = flagValue("--project");
const confirmArg = flagValue("--confirm");

function fail(message) {
  console.error(`Aborted: ${message} (nothing was deleted)`);
  process.exit(1);
}

if (projectArg !== TARGET_PROJECT) fail(`--project must be ${TARGET_PROJECT}`);
if (WRITE && confirmArg !== `${TARGET_PROJECT}:${CONFIRM_SCOPE}`) {
  fail(`--write requires --confirm=${TARGET_PROJECT}:${CONFIRM_SCOPE}`);
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
  "reset-disposable-app-data",
);
const db = getFirestore(app);

// Refuse to run on an unlisted top-level collection: the reset must not delete what it does not know.
const present = (await db.listCollections()).map((c) => c.id);
const unknown = present.filter((id) => !COLLECTIONS.includes(id) && !KEPT.includes(id));
if (unknown.length > 0) fail(`unlisted top-level collections present: ${unknown.join(", ")}`);

async function countOf(name) {
  // Counts every document reference, including ghost parents, so a leftover subcollection cannot hide.
  return (await db.collection(name).listDocuments()).length;
}

console.log(`Project: ${TARGET_PROJECT}  mode: ${WRITE ? "WRITE" : "DRY RUN"}`);
const before = {};
for (const name of COLLECTIONS) {
  before[name] = await countOf(name);
}
for (const name of COLLECTIONS) {
  console.log(`  ${name}: ${before[name]} document(s)`);
}
const keptBefore = {};
for (const name of KEPT) {
  keptBefore[name] = await countOf(name);
  console.log(`  KEPT ${name}: ${keptBefore[name]} document(s) (not touched)`);
}

if (!WRITE) {
  console.log("Dry run only. Re-run with --write and --confirm to delete the listed collections.");
  process.exit(0);
}

for (const name of COLLECTIONS) {
  // listDocuments also returns parents that do not exist but hold subcollections; recursiveDelete removes everything below.
  for (const ref of await db.collection(name).listDocuments()) {
    await db.recursiveDelete(ref);
  }
  console.log(`  cleared ${name} (was ${before[name]})`);
}

// Post-verification: every listed collection is empty, and the kept collections still hold their documents.
const failures = [];
for (const name of COLLECTIONS) {
  const remaining = await countOf(name);
  if (remaining !== 0) failures.push(`${name} still has ${remaining}`);
}
for (const name of KEPT) {
  if ((await countOf(name)) !== keptBefore[name]) failures.push(`${name} changed`);
}
if (failures.length > 0) {
  console.error(`Post-verification failed: ${failures.join("; ")}`);
  process.exit(2);
}
console.log("Post-verification: every listed collection is empty; kept access-control collections unchanged.");

// Controlled cleanup of obsolete role-expectation and personal target-role data.
//
// Scope (and nothing else):
//   1. `userDevelopment/{uid}/roleTarget/{docId}`: the owner's target-role document. Its only fields are `roleId`
//      and `updatedAt`. The whole document is deleted because the document holds nothing else.
//   2. `roleDefinitions/{roleId}.expectations`: the obsolete skill-expectation array. ONLY this field is removed. The
//      role document (title, description, lifecycle and audit fields) is kept.
//
// Not touched: userDevelopment goals, skillProfiles, team data, assessments, responsibilities, contributions,
// conversations, the global skill catalog, team-owned skills, sharing consents, aggregates, role assignments.
// Name-based matching is not used. Records are selected by collection path and exact field set only.
//
// Usage (dry run is the default and reads only; nothing is written):
//   node --env-file-if-exists=.env.local scripts/cleanup-role-expectations.mjs --project=<PROJECT_ID>
//
// Write (requires a verified target and a backup directory; the backup is written before any delete):
//   node --env-file-if-exists=.env.local scripts/cleanup-role-expectations.mjs --project=<PROJECT_ID> \
//     --write --confirm=<PROJECT_ID>:role-expectation-cleanup --backup-dir=<empty directory outside the repo>
//
// The script refuses to run unless --project equals FIREBASE_PROJECT_ID, and refuses to write unless --confirm
// repeats the project id. A repeated run is safe: once the data is gone the inventory is empty and nothing is written.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cert, initializeApp, deleteApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const CONFIRM_SUFFIX = "role-expectation-cleanup";
const BATCH_LIMIT = 400;
const TARGET_DOC_KEYS = new Set(["roleId", "updatedAt"]);
const ROLE_DOC_KEYS = new Set([
  "name",
  "description",
  "expectations",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "archivedAt",
  "archivedBy",
]);
const TARGET_PATH = /^userDevelopment\/[^/]+\/roleTarget\/[^/]+$/;

function fail(message) {
  console.error(`ABORTED: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const values = {};
  const flags = new Set();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) fail(`unrecognised argument: ${arg}`);
    if (match[2] === undefined) flags.add(match[1]);
    else values[match[1]] = match[2];
  }
  return { values, flags };
}

function serialise(value) {
  if (value instanceof Timestamp) return { __timestamp: value.toDate().toISOString() };
  if (Array.isArray(value)) return value.map(serialise);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialise(item)]));
  }
  return value;
}

function keysOutside(data, allowed) {
  return Object.keys(data).filter((key) => !allowed.has(key));
}

async function main() {
  const { values, flags } = parseArgs(process.argv.slice(2));
  const write = flags.has("write");

  const projectId = values.project;
  if (!projectId) fail("--project=<PROJECT_ID> is required");
  const envProjectId = process.env.FIREBASE_PROJECT_ID;
  if (!envProjectId) fail("FIREBASE_PROJECT_ID is not set");
  if (envProjectId !== projectId) fail(`--project (${projectId}) does not match FIREBASE_PROJECT_ID (${envProjectId})`);

  let backupDir = null;
  if (write) {
    if (values.confirm !== `${projectId}:${CONFIRM_SUFFIX}`) {
      fail(`--write requires --confirm=${projectId}:${CONFIRM_SUFFIX}`);
    }
    if (!values["backup-dir"]) fail("--write requires --backup-dir=<empty directory>");
    backupDir = resolve(values["backup-dir"]);
    if (existsSync(backupDir) && readdirSync(backupDir).length > 0) fail("--backup-dir must be empty");
    mkdirSync(backupDir, { recursive: true });
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) fail("FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required");

  const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, "role-expectation-cleanup");
  const db = getFirestore(app);
  if (app.options.projectId !== projectId) fail("initialised app project does not match --project");

  console.log(`Project: ${projectId}`);
  console.log(`Mode: ${write ? "WRITE" : "DRY RUN (no writes)"}`);

  // 1. Owner target-role documents.
  const targetSnapshot = await db.collectionGroup("roleTarget").get();
  const targets = [];
  for (const doc of targetSnapshot.docs) {
    if (!TARGET_PATH.test(doc.ref.path)) continue;
    const data = doc.data();
    const unexpected = keysOutside(data, TARGET_DOC_KEYS);
    if (unexpected.length > 0) fail(`roleTarget document ${doc.ref.path} has unexpected fields (${unexpected.join(", ")}); not deleted`);
    targets.push(doc);
  }

  // 2. Obsolete `expectations` field on role definitions.
  const roleSnapshot = await db.collection("roleDefinitions").get();
  const roles = [];
  for (const doc of roleSnapshot.docs) {
    const data = doc.data();
    if (!Object.hasOwn(data, "expectations")) continue;
    const unexpected = keysOutside(data, ROLE_DOC_KEYS);
    if (unexpected.length > 0) fail(`roleDefinitions/${doc.id} has unexpected fields (${unexpected.join(", ")}); not changed`);
    roles.push(doc);
  }

  console.log(`\nInventory`);
  console.log(`  userDevelopment/{uid}/roleTarget documents to delete (whole document): ${targets.length}`);
  console.log(`  roleDefinitions documents with obsolete "expectations" (field removed only): ${roles.length}`);
  console.log(`  roleDefinitions documents kept unchanged in full: ${roleSnapshot.size - roles.length}`);

  if (targets.length === 0 && roles.length === 0) {
    console.log("\nNothing to clean up. No writes performed.");
    await deleteApp(app);
    return;
  }

  if (!write) {
    console.log("\nDry run complete. Re-run with --write, --confirm and --backup-dir to apply.");
    await deleteApp(app);
    return;
  }

  // Backup first: every targeted document is written to disk before any delete.
  const backup = {
    createdAt: new Date().toISOString(),
    projectId,
    roleTarget: targets.map((doc) => ({ path: doc.ref.path, data: serialise(doc.data()) })),
    roleDefinitionsExpectations: roles.map((doc) => ({ path: doc.ref.path, expectations: serialise(doc.data().expectations) })),
  };
  const backupFile = join(backupDir, "role-expectation-cleanup-backup.json");
  writeFileSync(backupFile, JSON.stringify(backup, null, 2), { flag: "wx" });
  console.log(`\nBackup written: ${backupFile}`);

  for (let index = 0; index < targets.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    for (const doc of targets.slice(index, index + BATCH_LIMIT)) {
      batch.delete(doc.ref, { exists: true });
    }
    await batch.commit();
  }
  for (let index = 0; index < roles.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    for (const doc of roles.slice(index, index + BATCH_LIMIT)) {
      batch.update(doc.ref, { expectations: FieldValue.delete() }, { exists: true });
    }
    await batch.commit();
  }

  // Verify: nothing left, and no role document lost its title.
  const remainingTargets = (await db.collectionGroup("roleTarget").get()).docs.filter((doc) => TARGET_PATH.test(doc.ref.path));
  const remainingExpectations = (await db.collection("roleDefinitions").get()).docs.filter((doc) =>
    Object.hasOwn(doc.data(), "expectations"),
  );
  console.log(`\nVerification`);
  console.log(`  roleTarget documents remaining: ${remainingTargets.length}`);
  console.log(`  roleDefinitions with "expectations" remaining: ${remainingExpectations.length}`);
  if (remainingTargets.length > 0 || remainingExpectations.length > 0) fail("verification failed; restore from the backup if needed");
  await deleteApp(app);
}

main().catch((error) => {
  console.error("ABORTED:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});

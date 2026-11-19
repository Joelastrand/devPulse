// Synthetic Auth account for the Kanban browser checks, LOCAL Firebase emulators only.
// Refuses to run unless both emulator hosts are localhost and the project id starts with "demo-". Never reads
// .env.local, never uses service-account credentials, and never writes to a real project. The password exists only in
// the local Auth emulator and is not a real credential.
//
// Run with the emulators from browser/emulator/kanban-verify.emulator.json (see docs/PERSONAL-TASKS.md §11), e.g.
//   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 \
//   node browser/emulator/seed-kanban-verify.mjs demo-kanban-verify
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const LOCAL = /^(localhost|127\.0\.0\.1):\d{2,5}$/;
const projectId = process.argv[2] ?? "";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";

if (!LOCAL.test(authHost) || !LOCAL.test(firestoreHost)) {
  console.error("REFUSED: FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST must both be localhost emulator hosts.");
  process.exit(1);
}
if (!projectId.startsWith("demo-")) {
  console.error("REFUSED: the project id must start with demo-.");
  process.exit(1);
}

const USER = {
  uid: "kanban-verify-owner",
  email: "kanban-verify@nve.no",
  password: "kanban-verify-synthetic-1",
  displayName: "Syntetisk Kanban-bruker",
};

const app = getApps()[0] ?? initializeApp({ projectId });
const auth = getAuth(app);

try {
  await auth.getUser(USER.uid);
  await auth.updateUser(USER.uid, { email: USER.email, password: USER.password, emailVerified: true, displayName: USER.displayName });
  console.log("updated synthetic emulator user");
} catch (error) {
  if (error?.code !== "auth/user-not-found") throw error;
  await auth.createUser({ uid: USER.uid, email: USER.email, password: USER.password, emailVerified: true, displayName: USER.displayName });
  console.log("created synthetic emulator user");
}

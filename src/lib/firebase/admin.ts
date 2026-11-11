import "server-only";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertAdminEmulatorSafe } from "./emulator-config";

/**
 * Centralized, server-only Firebase Admin SDK initialization. Credentials
 * come from server-only environment variables (or the platform's default
 * application credentials) and are never exposed to client-reachable code.
 */
function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) {
    return existing;
  }

  // Fail closed: emulator hosts (read by the SDK from the environment) must be local and must use a demo- project.
  assertAdminEmulatorSafe(process.env);
  return initializeApp(buildAppOptions());
}

function buildAppOptions() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }) };
  }

  // No cert credentials (local emulator or platform default credentials): still pass the configured project id,
  // so the SDK does not depend on a Google project being detected from the environment.
  return { projectId: projectId || undefined, credential: applicationDefault() };
}

export function getFirestoreDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

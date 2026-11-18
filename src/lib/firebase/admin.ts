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
/** firebase-admin's name for the default app. Every owner operation and the project-binding check use this one instance. */
const DEFAULT_APP_NAME = "[DEFAULT]";

function getAdminApp(): App {
  // Selected by name, never by position: a named app (for example a seed's dedicated app) must not stand in for the default
  // app. The binding check and every owner operation both come through here, so they always validate the same instance.
  const existing = getApps().find((app) => app.name === DEFAULT_APP_NAME);
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

/**
 * The project the default Admin app is bound to, read-only (no initialization change). Taken from the app options, or from a
 * service-account credential's project id. `undefined` when neither is known (for example application default credentials
 * without a project), so a caller that requires an exact project fails closed.
 */
export function getAdminAppProjectId(): string | undefined {
  const app = getAdminApp();
  if (app.options.projectId) return app.options.projectId;
  const credential = app.options.credential as { projectId?: unknown } | undefined;
  return typeof credential?.projectId === "string" ? credential.projectId : undefined;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

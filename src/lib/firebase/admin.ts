import "server-only";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

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

  return initializeApp(buildAppOptions());
}

function buildAppOptions() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }) };
  }

  return { credential: applicationDefault() };
}

export function getFirestoreDb(): Firestore {
  return getFirestore(getAdminApp());
}

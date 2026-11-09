import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { resolveAuthEmulatorUrl } from "./emulator-config";

/**
 * Centralized, browser-safe Firebase client SDK initialization. Firebase's
 * web config values (apiKey, authDomain, etc.) identify the project but are
 * not secrets, so they are read from `NEXT_PUBLIC_*` env vars — this module
 * must never read server-only credentials (see `src/lib/firebase/admin.ts`).
 */
function getFirebaseApp(): FirebaseApp {
  const existing = getApps()[0];
  if (existing) {
    return existing;
  }

  return initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
}

let emulatorConnected = false;

export function getFirebaseAuth(): Auth {
  const auth = getAuth(getFirebaseApp());
  // Local verification only: explicit env var, refused in production and for non-demo projects (emulator-config.ts).
  const emulatorUrl = resolveAuthEmulatorUrl({
    authUrl: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
  if (emulatorUrl && !emulatorConnected) {
    connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
    emulatorConnected = true;
  }
  return auth;
}

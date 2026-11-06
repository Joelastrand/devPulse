import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Browser verification harness guards (BR-37, TASK-001).
// Credentials come only from runtime environment variables. Their values are
// never printed, logged, written to a file, or included in an error message.

// Optional override for a freshly started local dev server (e.g. a port other than 3000 when an older
// process holds 3000). Only localhost origins are accepted; anything else falls back to the default.
const LOCAL_ORIGIN = /^http:\/\/localhost:\d{2,5}$/;
export const BASE_URL = LOCAL_ORIGIN.test(process.env.DEVPULSE_VERIFY_BASE_URL ?? "")
  ? (process.env.DEVPULSE_VERIFY_BASE_URL as string)
  : "http://localhost:3000";
export const OUTPUT_DIR = fileURLToPath(new URL("../.verify-output/", import.meta.url));
const ENV_LOCAL = fileURLToPath(new URL("../.env.local", import.meta.url));

export const CREDENTIAL_VARS = ["DEVPULSE_VERIFY_EMAIL", "DEVPULSE_VERIFY_PASSWORD"] as const;

export type CredentialCheck =
  | { ok: true; email: string; password: string }
  | { ok: false; message: string };

export function readCredentials(env: NodeJS.ProcessEnv = process.env): CredentialCheck {
  const missing = CREDENTIAL_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    return {
      ok: false,
      message:
        `NOT VERIFIED: browser verification did not run. Set ${CREDENTIAL_VARS.join(" and ")} ` +
        `in the runtime environment (owner's test account only). Missing: ${missing.join(", ")}.`,
    };
  }
  return { ok: true, email: env.DEVPULSE_VERIFY_EMAIL as string, password: env.DEVPULSE_VERIFY_PASSWORD as string };
}

// Reads only the Firebase project identifier from .env.local to refuse production (BR-37).
// The value is never printed.
export function configuredFirebaseProjectId(path: string = ENV_LOCAL): string | null {
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^NEXT_PUBLIC_FIREBASE_PROJECT_ID=(.*)$/.exec(line.trim());
    if (match) return match[1].replace(/^["']|["']$/g, "").trim();
  }
  return null;
}

export function checkProjectIsNotProduction(projectId: string | null): { ok: true } | { ok: false; message: string } {
  if (!projectId) {
    return { ok: false, message: "NOT VERIFIED: NEXT_PUBLIC_FIREBASE_PROJECT_ID is not configured in .env.local; the run stops." };
  }
  if (/prod/i.test(projectId)) {
    return { ok: false, message: "STOPPED: the configured Firebase project is identified as production. Browser verification refuses to run (BR-37)." };
  }
  return { ok: true };
}

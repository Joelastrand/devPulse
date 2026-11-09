/**
 * Local Firebase Emulator switch for browser verification (browser/README-style harness in
 * docs/features/team-experience-redesign/VERIFICATION.md). Fail-closed by design:
 *
 * - Off unless the emulator URL is set explicitly.
 * - Refused in production builds (`NODE_ENV === "production"`).
 * - The URL must be a plain localhost/127.0.0.1 http origin.
 * - The project id must start with `demo-` (the Firebase emulator convention for a project that cannot be real).
 *
 * Any violation throws, so a misconfigured environment never silently falls back to a real project. This module
 * changes no authorization behaviour; it only chooses which Auth endpoint the client SDK talks to.
 */

const LOCAL_HTTP_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/;
const DEMO_PROJECT_PREFIX = "demo-";

export interface AuthEmulatorInput {
  authUrl: string | undefined;
  projectId: string | undefined;
  /** Defaults to the runtime `NODE_ENV`; read here so the browser client module reads only NEXT_PUBLIC_ variables. */
  nodeEnv?: string | undefined;
}

/** Returns the local Auth emulator origin, `null` when the emulator is not requested, or throws when it is misconfigured. */
export function resolveAuthEmulatorUrl(input: AuthEmulatorInput): string | null {
  if (!input.authUrl) return null;
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv === "production") {
    throw new Error("Firebase Auth emulator is not allowed in a production build.");
  }
  if (!LOCAL_HTTP_ORIGIN.test(input.authUrl)) {
    throw new Error("Firebase Auth emulator URL must be a local http origin (localhost or 127.0.0.1).");
  }
  if (!input.projectId?.startsWith(DEMO_PROJECT_PREFIX)) {
    throw new Error("Firebase Auth emulator requires a demo- project id; refusing to use a real project.");
  }
  return input.authUrl;
}

/** Shared guard for the server Admin SDK: when emulator hosts are set, they must be local and the project must be demo-. */
export function assertAdminEmulatorSafe(env: Partial<NodeJS.ProcessEnv>): void {
  const hosts = [env.FIRESTORE_EMULATOR_HOST, env.FIREBASE_AUTH_EMULATOR_HOST].filter(
    (host): host is string => typeof host === "string" && host.length > 0,
  );
  if (hosts.length === 0) return;
  if (env.NODE_ENV === "production") {
    throw new Error("Firebase emulator hosts are not allowed in a production runtime.");
  }
  if (!hosts.every((host) => /^(localhost|127\.0\.0\.1):\d{2,5}$/.test(host))) {
    throw new Error("Firebase emulator host must be localhost or 127.0.0.1.");
  }
  if (!(env.FIREBASE_PROJECT_ID ?? "").startsWith(DEMO_PROJECT_PREFIX)) {
    throw new Error("Firebase emulator hosts require a demo- FIREBASE_PROJECT_ID; refusing to use a real project.");
  }
}

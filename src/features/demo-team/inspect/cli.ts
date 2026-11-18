import { resolveDemoSeedConfig } from "../config";
import { demoCrypto } from "../crypto";
import { stripForwardedSeparator } from "../runner";
import { loadIdentityAdminSdk, type IdentityAdminSdk } from "../identities/adapters";
import { normalizePrivateKey } from "../adapters";
import { INSPECTED_COLLECTIONS, inspectLiveFixtures, summarize, type LiveReader } from "./live-mismatch";

/**
 * Process boundary for `pnpm inspect:demo-team-live` (Phase D, section 6). READ-ONLY: the reader can only `get` documents of the
 * seven demo collections. It has no write method. Prints per-collection counts and field NAMES that differ. It never prints
 * field values, and it never prints sealed content.
 */

const READABLE: readonly string[] = INSPECTED_COLLECTIONS;

async function main(): Promise<void> {
  const argv = stripForwardedSeparator(process.argv.slice(2));
  const resolved = resolveDemoSeedConfig({ argv, env: process.env, now: () => new Date() });
  if (!resolved.ok) {
    process.stderr.write(`Configuration error: ${resolved.error.category}\n`);
    process.exitCode = 2;
    return;
  }
  const config = resolved.config;
  if (config.credentials === null) {
    process.stderr.write(`Aborted: credentials-missing (nothing was read)\n`);
    process.exitCode = 1;
    return;
  }

  const sdk: IdentityAdminSdk = await loadIdentityAdminSdk();
  const credential = sdk.cert({
    projectId: config.projectId,
    clientEmail: config.credentials.clientEmail,
    privateKey: normalizePrivateKey(config.credentials.privateKey),
  });
  const app = sdk.initializeApp({ credential, projectId: config.projectId }, "demo-live-inspection");
  if (app.options.projectId !== config.projectId) {
    process.stderr.write(`Aborted: project-binding-mismatch\n`);
    process.exitCode = 1;
    return;
  }
  const db = sdk.getFirestore(app) as unknown as {
    doc(path: string): { get(): Promise<{ exists: boolean; data(): unknown }> };
  };

  const reader: LiveReader = {
    async readDoc(path) {
      if (!READABLE.includes(path.split("/")[0])) throw new Error("Path rejected: not an inspected collection.");
      const snapshot = await db.doc(path).get();
      return snapshot.exists ? { exists: true, data: snapshot.data() } : { exists: false };
    },
  };

  const results = await inspectLiveFixtures({
    reader,
    teamId: config.teamId,
    presenterUid: config.presenterUid,
    asOf: config.asOf,
    crypto: demoCrypto,
  });
  process.stdout.write(`Project: ${config.projectId} (read-only inspection, no writes)\n`);
  process.stdout.write(`Team: ${config.teamId}\n`);
  for (const line of summarize(results)) process.stdout.write(`${line}\n`);
}

void main().catch(() => {
  process.stderr.write(`Aborted: internal-error (nothing was written)\n`);
  process.exitCode = 1;
});

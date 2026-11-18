import { demoCrypto } from "../crypto";
import { stripForwardedSeparator } from "../runner";
import { loadIdentityAdminSdk } from "../identities/adapters";
import { createParticipationOnlineAdapters } from "./adapters";
import { runParticipationProvisioning } from "./runner";

/**
 * Process boundary for `pnpm seed:demo-team-participations` (Phase D). Offline validation, read-only live preflight (default with
 * live flags), and — only with `--write --confirm=<projectId>` and a conflict-free plan — one transaction that sets the missing
 * memberRef values and creates the missing participations. Prints only the runner's redacted lines.
 */
async function main(): Promise<void> {
  try {
    const { exitCode, stdout, stderr } = await runParticipationProvisioning({
      argv: stripForwardedSeparator(process.argv.slice(2)),
      env: process.env,
      now: () => new Date(),
      crypto: demoCrypto,
      createOnlineAdapters: async ({ projectId, credentials }) =>
        createParticipationOnlineAdapters({ sdk: await loadIdentityAdminSdk(), projectId, ...credentials }),
    });
    for (const line of stdout) process.stdout.write(`${line}\n`);
    for (const line of stderr) process.stderr.write(`${line}\n`);
    process.exitCode = exitCode;
  } catch {
    process.stderr.write(`Aborted: internal-error (nothing was written)\n`);
    process.exitCode = 1;
  }
}

void main();

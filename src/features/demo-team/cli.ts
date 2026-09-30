import { createFirebaseDemoAdapters, loadFirebaseAdminSdk } from "./adapters";
import { demoCrypto } from "./crypto";
import { runDemoSeed, stripForwardedSeparator } from "./runner";

/**
 * Process boundary for `pnpm seed:demo-team` (see `package.json`). Runs under
 * plain Node type stripping; see `register-ts-resolver.mjs`. Prints only the
 * runner's redacted lines — never environment values or raw errors.
 */
async function main(): Promise<void> {
  try {
    const { exitCode, stdout, stderr } = await runDemoSeed({
      argv: stripForwardedSeparator(process.argv.slice(2)),
      env: process.env,
      now: () => new Date(),
      crypto: demoCrypto,
      createOnlineAdapters: async ({ projectId, credentials }) =>
        createFirebaseDemoAdapters({ sdk: await loadFirebaseAdminSdk(), projectId, ...credentials }),
    });
    for (const line of stdout) console.log(line);
    for (const line of stderr) console.error(line);
    process.exitCode = exitCode;
  } catch {
    console.error("Aborted: internal-error (nothing was written)");
    process.exitCode = 1;
  }
}

void main();

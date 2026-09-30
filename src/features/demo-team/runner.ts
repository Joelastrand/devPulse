import { DemoAdapterError, type DemoOnlineAdapters } from "./adapters";
import { resolveDemoSeedConfig, type DemoSeedCredentials } from "./config";
import { buildDemoSeedPlan } from "./plan";
import {
  formatDemoDryRunReport,
  runDemoPreflight,
  runLocalCryptoPreflight,
  type DemoCrypto,
  type DemoPreflightResult,
} from "./preflight";
import { DemoWriteError, writeDemoOperations } from "./writer";

/**
 * Runner: wires config → (online) adapters → preflight → report, and — only in
 * explicit write mode after every gate — the guarded writer (docs/features/
 * demo-team/SPEC.md "Execution interface", BR-3, BR-29, BR-30). All I/O is
 * injected; the runner returns lines instead of printing, so nothing here can
 * leak raw errors, credentials or document data: failures are fixed categories.
 *
 * Order: validate args/env → local crypto round-trip → build + encrypt the plan
 * → (online only) build adapters → presenter check and manifest reads →
 * classification → (write only) single batch commit. Adapters are constructed
 * only after config validation and never offline.
 */

export interface DemoRunnerInput {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  crypto: DemoCrypto;
  /** Called only when the validated config allows network. Never called offline. */
  createOnlineAdapters: (target: {
    projectId: string;
    credentials: DemoSeedCredentials;
  }) => Promise<DemoOnlineAdapters>;
}

export interface DemoRunnerOutput {
  /** 0 ok · 1 preflight/adapter/write failure · 2 configuration/usage error. */
  exitCode: 0 | 1 | 2;
  stdout: string[];
  stderr: string[];
}

/**
 * `pnpm seed:demo-team -- --project …` hands the script a leading bare `--`
 * (verified with pnpm 10.33.2). Drop exactly that one separator at the process
 * boundary; the parser still rejects every other positional argument.
 */
export function stripForwardedSeparator(argv: readonly string[]): string[] {
  return argv[0] === "--" ? argv.slice(1) : [...argv];
}

function abort(stdout: string[], category: string, exitCode: 1 | 2 = 1): DemoRunnerOutput {
  return { exitCode, stdout, stderr: [`Aborted: ${category} (nothing was written)`] };
}

export async function runDemoSeed(input: DemoRunnerInput): Promise<DemoRunnerOutput> {
  const resolved = resolveDemoSeedConfig({ argv: input.argv, env: input.env, now: input.now });
  if (!resolved.ok) {
    const { category, subject } = resolved.error;
    return {
      exitCode: 2,
      stdout: [],
      stderr: [`Configuration error: ${category}${subject === undefined ? "" : ` (${subject})`}`],
    };
  }
  const { config } = resolved;
  const { crypto } = input;
  const report = (operations: Parameters<typeof formatDemoDryRunReport>[0]["operations"], result: DemoPreflightResult) =>
    formatDemoDryRunReport({ config, operations, result });

  if (!runLocalCryptoPreflight(crypto)) {
    const failed: DemoPreflightResult = { ok: false, error: { category: "crypto-failed" }, classifications: [] };
    return abort(report([], failed), "crypto-failed");
  }

  let plan: ReturnType<typeof buildDemoSeedPlan>;
  try {
    plan = buildDemoSeedPlan({ presenterUid: config.presenterUid, asOf: config.asOf, encrypt: crypto.encrypt });
  } catch {
    return abort([], "plan-failed");
  }

  let adapters: DemoOnlineAdapters | undefined;
  if (config.network) {
    if (config.credentials === null) return abort([], "adapters-missing");
    try {
      adapters = await input.createOnlineAdapters({
        projectId: config.projectId,
        credentials: config.credentials,
      });
    } catch (error) {
      return abort([], error instanceof DemoAdapterError ? error.category : "adapters-failed");
    }
  }

  let preflight: DemoPreflightResult;
  try {
    preflight = await runDemoPreflight({
      config,
      operations: plan.operations,
      manifest: plan.manifest,
      crypto,
      online: adapters === undefined ? undefined : { reader: adapters.reader, presenter: adapters.presenter },
    });
  } catch {
    return abort([], "preflight-failed");
  }

  const lines = report(plan.operations, preflight);
  if (!preflight.ok) return abort(lines, preflight.error.category);
  if (config.mode !== "write") return { exitCode: 0, stdout: lines, stderr: [] };

  // Write gates (all required): explicit `--write` with matching `--confirm`
  // and target proof (config), adapters built, preflight green against real
  // existing state (no conflict), and something to write. The writer then
  // re-validates the manifest as the last guard before the batch.
  if (!config.writesAllowed || adapters === undefined || !preflight.existingStateChecked) {
    return abort(lines, "write-gate-not-satisfied");
  }
  if (preflight.plannedOperations.length === 0) {
    return abort(lines, "nothing-to-write");
  }

  try {
    const { written } = await writeDemoOperations({
      operations: preflight.plannedOperations,
      manifest: plan.manifest,
      createBatch: adapters.createBatch,
    });
    return { exitCode: 0, stdout: [...lines, `Write: committed ${written} documents in one batch. Deletes: 0`], stderr: [] };
  } catch (error) {
    return abort(lines, error instanceof DemoWriteError ? error.category : "write_failed");
  }
}

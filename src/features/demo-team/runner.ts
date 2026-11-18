import { DEMO_TEAM_ID } from "./fixtures";
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
import { runPersonalSeed, type PersonalWriters } from "./personal-seed";

/**
 * Runner: wires config → (online) adapters → preflight → report, and — only in
 * explicit write mode after every gate — the guarded writer (docs/archive/features/
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
  /**
   * Personal seed writers (`--personal` mode only). Called only after the personal orchestrator's write gates pass.
   * Absent in tests and when no owner-module wiring is supplied, in which case a personal write refuses.
   */
  loadPersonalWriters?: (presenterUid: string) => Promise<PersonalWriters>;
  /** Personal mode only: the project the owner operations' Admin app is bound to (production default when absent). */
  resolvePersonalBoundProjectId?: () => Promise<string | undefined>;
}

/** The personal demo-data mode of this same command: `pnpm seed:demo-team -- --personal …`. Team mode is the default. */
export const PERSONAL_MODE_FLAG = "--personal";

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
  // Personal mode routes to the trusted personal orchestrator with the same argv gates (project proof, presenter UID,
  // `--write --confirm`). The flag itself is removed first, so the shared parser never sees an unknown flag.
  if (input.argv.includes(PERSONAL_MODE_FLAG)) {
    return runPersonalSeed({
      argv: input.argv.filter((arg) => arg !== PERSONAL_MODE_FLAG),
      env: input.env,
      now: input.now,
      loadWriters: input.loadPersonalWriters,
      resolveBoundProjectId: input.resolvePersonalBoundProjectId,
    });
  }
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
    plan = buildDemoSeedPlan({
      presenterUid: config.presenterUid,
      teamId: config.teamId,
      asOf: config.asOf,
      sealRecord: crypto.sealRecord,
    });
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
      scope: { teamId: config.teamId, reuseExistingTeam: config.teamId !== DEMO_TEAM_ID, presenterUid: config.presenterUid },
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
    // Converged: every planned document already exists identically. Nothing is written, so this is a successful rerun.
    return { exitCode: 0, stdout: [...lines, "Write: nothing to write; every planned document already exists identically. Deletes: 0"], stderr: [] };
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

/**
 * Process boundary for the demo personal-task seed (docs/PERSONAL-TASKS.md §10). Run `--mode preflight` first: it is
 * read-only and prints the exact records and the confirmation digest. `--mode write` is never the default. It needs
 * `--confirm <digest>` copied from a preflight of the same batch, is refused before any read without it, and revalidates
 * everything inside one transaction. It creates only missing demo records; it never updates or deletes anything.
 *
 * Fixed target: project `devpulse-nve`, owner `koEwzQcj5Uc0hnjTgZBLithgkYB3`. A different project or uid is refused before
 * any Firebase call. Output contains fictional titles, counts, ids and the digest only. Never environment values.
 */
import { DEMO_PRESENTER_UID, DEMO_PROJECT_ID, DEMO_TASK_SPECS } from "./demo-dataset";
import { getDemoPresenterStorage, runDemoSeed, type DemoRunMode, type DemoRunReport } from "./demo-storage";

interface CliArgs {
  mode: DemoRunMode;
  project: string;
  owner: string;
  confirm: string | undefined;
}

function parseArgs(argv: readonly string[]): CliArgs | null {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const mode = value("--mode");
  const project = value("--project");
  const owner = value("--owner");
  if ((mode !== "preflight" && mode !== "write") || !project || !owner) return null;
  return { mode, project, owner, confirm: value("--confirm") };
}

function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

function printPlan(report: Extract<DemoRunReport, { plan: unknown }>): void {
  const { plan } = report;
  line(`project: ${plan.project}`);
  line(`owner: ${plan.owner}`);
  line(`planned records: ${plan.entries.length}`);
  line(`status counts: backlog ${plan.statusCounts.backlog}, doing ${plan.statusCounts.doing}, blocked ${plan.statusCounts.blocked}, done ${plan.statusCounts.done}`);
  line(`history (outside the 7-day window at the reference date): ${plan.historyCount}`);
  line(`create ${plan.counts.create}, skip ${plan.counts.skip}, conflict ${plan.counts.conflict}`);
  const specs = new Map(DEMO_TASK_SPECS.map((spec) => [`kanban-demo-${spec.key}`, spec]));
  for (const entry of plan.entries) {
    const spec = specs.get(entry.id);
    line(`  ${entry.action.padEnd(8)} ${entry.id} [${entry.status}] ${spec?.title ?? ""}`);
  }
  line(`digest: ${plan.digest}`);
}

function refusalText(reason: string): string {
  switch (reason) {
    case "argument-mismatch":
      return "the project or owner does not match the fixed demo target";
    case "conflicts-present":
      return "conflicting or unreadable demo records exist; nothing will be written";
    case "confirmation-required":
      return "a write needs --confirm <digest> from a preflight of the same batch";
    case "confirmation-mismatch":
      return "the confirmation digest does not match the current plan (the stored state changed, or the digest is wrong)";
    default:
      return reason;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    process.stderr.write(
      `Usage: --mode preflight|write --project ${DEMO_PROJECT_ID} --owner ${DEMO_PRESENTER_UID} [--confirm <digest>]\n`,
    );
    process.exitCode = 2;
    return;
  }
  if (args.project !== DEMO_PROJECT_ID || args.owner !== DEMO_PRESENTER_UID) {
    process.stderr.write("Aborted: argument-mismatch (nothing was read or written)\n");
    process.exitCode = 1;
    return;
  }
  if (process.env.FIREBASE_PROJECT_ID !== DEMO_PROJECT_ID) {
    process.stderr.write("Aborted: the configured Firebase project is not the demo target (nothing was read or written)\n");
    process.exitCode = 1;
    return;
  }

  const storage = getDemoPresenterStorage(args.owner);
  const report = await runDemoSeed(storage, args);

  switch (report.outcome) {
    case "refused":
      line(`refused (${report.reason}): ${refusalText(report.reason)}`);
      if (report.plan) printPlan({ outcome: "preflight", plan: report.plan, ordinaryCount: 0, blocked: true });
      process.exitCode = 1;
      return;
    case "preflight":
      line(`preflight (read-only). ordinary tasks of the owner: ${report.ordinaryCount} (not read or changed)`);
      printPlan(report);
      line(report.blocked ? "result: BLOCKED (conflicts)" : "result: ok");
      if (report.blocked) process.exitCode = 1;
      return;
    case "written":
      printPlan(report);
      line(`written: ${report.created} record(s) created. Post-write verification: all planned records match.`);
      return;
    case "no_changes":
      printPlan(report);
      line("no changes: every planned record already matches. Zero writes.");
      return;
    case "post_write_verification_failed":
      printPlan(report);
      line("post-write verification FAILED. Do not re-run blindly; run a preflight and compare the counts.");
      process.exitCode = 1;
      return;
    case "storage_failed":
      process.stderr.write("Aborted: storage failed (the write outcome is not confirmed; run a preflight)\n");
      process.exitCode = 1;
      return;
  }
}

await main();

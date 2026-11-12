#!/usr/bin/env node
// Verification tiers for DevPulse. See docs/TESTING.md §1a.
//
//   quick     Task-scoped: tests related to the selected files (Vitest import graph),
//             the selected test files themselves, and the security guards.
//   standard  quick, plus every test in the feature folders of the selected files,
//             plus typecheck and ESLint on the selected files.
//   full      Entire Vitest suite + typecheck + lint. Emulator suites run only when the emulator is reachable.
//   emulator  Only the *.emulator.test.ts suites against the local Firestore emulator. Fails when it is not running.
//
// Selection for quick and standard (exactly one is required; there is no silent default):
//   --files <path> [<path> ...]   explicit files or directories for the current task (recommended)
//   --files-from <file>           the same, one path per line (for long lists)
//   --changed                     every file changed in the working tree vs HEAD. Intentional use only: the
//                                 working tree may hold hundreds of unrelated uncommitted changes.
//   --dry-run                     print the selection and the commands without running them
//
// Run through pnpm: pnpm test:quick -- --files <paths>  |  pnpm test:standard -- --files <paths>

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIERS = ["quick", "standard", "full", "emulator"];
const tier = process.argv[2];

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    [
      "Usage: node scripts/test-tier.mjs <quick|standard|full|emulator> [selection] [--dry-run]",
      "Selection (quick and standard; one of):",
      "  --files <path> [<path> ...]   explicit files or directories for the current task",
      "  --files-from <file>           one path per line",
      "  --changed                     all changed files in the working tree (intentional use only)",
    ].join("\n"),
  );
  process.exit(2);
}

if (!TIERS.includes(tier)) usage(`unknown tier "${tier ?? ""}"`);

// Argument parsing. Nothing is silently ignored: unknown flags are an error.
const dryRun = process.argv.includes("--dry-run");
let mode = null; // "files" | "changed"
const explicitArgs = [];
for (let i = 3; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--dry-run") continue;
  if (arg === "--changed") {
    if (mode === "files") usage("--changed cannot be combined with --files");
    mode = "changed";
  } else if (arg === "--files") {
    if (mode === "changed") usage("--files cannot be combined with --changed");
    mode = "files";
  } else if (arg === "--files-from") {
    if (mode === "changed") usage("--files-from cannot be combined with --changed");
    mode = "files";
    const listFile = process.argv[++i];
    if (!listFile) usage("--files-from needs a file");
    const listPath = path.resolve(root, listFile);
    if (!existsSync(listPath)) usage(`list file not found: ${listFile}`);
    explicitArgs.push(
      ...readFileSync(listPath, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")),
    );
  } else if (arg.startsWith("--")) {
    usage(`unknown option ${arg}`);
  } else if (mode === "files") {
    explicitArgs.push(arg);
  } else {
    usage(`unexpected argument ${arg}. Put file paths after --files`);
  }
}

if (tier === "quick" || tier === "standard") {
  if (!mode) usage(`${tier} needs a selection: --files <paths> (recommended) or --changed`);
  if (mode === "files" && explicitArgs.length === 0) usage("--files was given no paths");
}

// Security and architecture guards (docs/TESTING.md §4) plus the security-critical
// codec, storage-boundary, auth and ownership suites. They run on quick and standard
// whatever the selection, because several guards read source text with fs, so no
// import edge connects them to the code they protect.
const SECURITY_GUARD_PATTERNS = [
  "src/features/account-erasure/server/inventory.test.ts",
  "src/features/superadmins/firestore-registry-rules.test.ts",
  "src/features/**/*scope-guard.test.ts",
  "src/features/**/*repo-guard.test.ts",
  "src/features/personal-role-workspace/d2-boundary.test.ts",
  "src/features/role-profiles/cross-feature-regression.test.ts",
  "src/features/team-skills/server/teamkompetanse-leak-regression.test.ts",
  "src/components/ui/motion-audit.test.ts",
  "src/lib/encryption/**/*.test.ts",
  "src/lib/auth/**/*.test.ts",
  "src/features/auth/**/*.test.ts",
  "src/features/superadmins/**/*.test.ts",
  "src/features/**/*-codec.test.ts",
  "src/features/**/*content-codec.test.ts",
  "src/features/**/*.storage.test.ts",
  "src/features/**/*storage-boundary*.test.ts",
  "src/features/**/*owner-isolation*.test.ts",
  "app/api/**/*owner-isolation*.test.ts",
];

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const EMULATOR_PROJECT = process.env.DEVPULSE_EMULATOR_PROJECT ?? "demo-devpulse-verify";

const git = (args) =>
  execFileSync("git", ["-c", "core.quotepath=off", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], // git's CRLF warnings on stderr are noise here
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

// Local binaries are called directly, without a shell: pnpm is a .cmd shim on Windows,
// and a shell would split paths such as app/(app)/... on parentheses.
const bin = (relative) => path.join(root, "node_modules", relative);
const VITEST = bin("vitest/vitest.mjs");
const TSC = bin("typescript/bin/tsc");
const ESLINT = bin("eslint/bin/eslint.js");

const CODE_FILE = /\.(ts|tsx|mjs|js)$/;
const CODE_ROOT = /^(src|app|scripts|test)\//;
const isTestFile = (f) => /\.(test|spec)\.(ts|tsx)$/.test(f);
const toPosix = (p) => p.split(path.sep).join("/");

// Normalise a user-supplied path (Windows or POSIX separators, absolute or relative) to a
// repo-relative POSIX path. Fails loudly for paths outside the repository or missing files.
function normalizeInput(input) {
  const abs = path.resolve(root, input);
  const rel = toPosix(path.relative(root, abs));
  if (rel.startsWith("..") || path.isAbsolute(rel)) usage(`path is outside the repository: ${input}`);
  if (!existsSync(abs)) usage(`no such file or directory: ${input}`);
  return rel;
}

// Explicit selection → { tests, sources, notes }. Directories expand to the test files under them.
function resolveExplicit(inputs) {
  const tests = new Set();
  const sources = new Set();
  const notes = [];
  for (const input of inputs) {
    const rel = normalizeInput(input);
    if (statSync(path.join(root, rel)).isDirectory()) {
      const found = globSync(`${rel}/**/*.{test,spec}.{ts,tsx}`, { cwd: root }).map(toPosix);
      if (found.length === 0) notes.push(`directory ${rel} has no test files; no tests selected from it`);
      for (const f of found) tests.add(f);
    } else if (isTestFile(rel)) {
      tests.add(rel);
    } else if (CODE_FILE.test(rel) && CODE_ROOT.test(rel)) {
      sources.add(rel);
    } else {
      notes.push(`${rel} is not a TypeScript/JavaScript source under src, app, scripts or test; it selects no tests`);
    }
  }
  return { tests: [...tests].sort(), sources: [...sources].sort(), notes };
}

// Changed or untracked files relative to HEAD (includes uncommitted work in progress).
function changedFiles() {
  const names = new Set([
    ...git(["diff", "--name-only", "HEAD"]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ]);
  const usable = [...names].filter((f) => CODE_FILE.test(f) && CODE_ROOT.test(f) && existsSync(path.join(root, f)));
  return {
    tests: usable.filter(isTestFile).sort(),
    sources: usable.filter((f) => !isTestFile(f)).sort(),
    notes: [],
  };
}

function guardFiles() {
  const found = new Set();
  for (const pattern of SECURITY_GUARD_PATTERNS) {
    for (const file of globSync(pattern, { cwd: root })) found.add(toPosix(file));
  }
  return [...found].sort();
}

// Feature folder of a file, e.g. src/features/team-systems.
function featureFolders(files) {
  const folders = new Set();
  for (const f of files) {
    const m = /^src\/features\/[^/]+/.exec(f);
    if (m) folders.add(m[0]);
  }
  return [...folders].sort();
}

function run(label, script, args) {
  console.log(`\n== ${label}: node ${[path.relative(root, script), ...args].join(" ")}`);
  if (dryRun) return 0;
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

// Windows limits a command line to about 32k characters. Split long lists into chunks.
const MAX_ARG_CHARS = 20000;
function chunkArgs(files) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const f of files) {
    if (current.length > 0 && size + f.length + 1 > MAX_ARG_CHARS) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(f);
    size += f.length + 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// Runs every chunk and returns the first non-zero status (or 0).
function runChunks(label, script, prefix, files) {
  let status = 0;
  for (const chunk of chunkArgs(files)) {
    const s = run(label, script, [...prefix, ...chunk]);
    if (s !== 0 && status === 0) status = s;
  }
  return status;
}

function emulatorReachable() {
  const [host, portText] = EMULATOR_HOST.split(":");
  return new Promise((resolve) => {
    const socket = connect({ host, port: Number(portText) });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function printSelection(selection, guards) {
  console.log(`\nSelection mode: ${mode === "changed" ? "ALL working-tree changes (--changed)" : "explicit files (--files)"}`);
  for (const t of selection.tests) console.log(`  test   ${t}   [selected as a test file]`);
  for (const s of selection.sources) console.log(`  source ${s}   [related tests chosen by Vitest import graph]`);
  for (const n of selection.notes) console.log(`  note   ${n}`);
  console.log(`  guard  ${guards.length} security guard files   [always run on quick and standard]`);
  if (selection.tests.length === 0 && selection.sources.length === 0) {
    console.log("  (no source or test files selected)");
  }
}

async function main() {
  if (tier === "emulator") {
    if (!dryRun && !(await emulatorReachable())) {
      console.error(
        `\nFirestore emulator is not reachable at ${EMULATOR_HOST}. Start it first:\n` +
          "  firebase emulators:start --only auth,firestore --project " + EMULATOR_PROJECT + "\n" +
          "The emulator suites skip silently without it, so this tier refuses to report a pass.",
      );
      process.exit(1);
    }
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
    process.env.DEVPULSE_EMULATOR_PROJECT = EMULATOR_PROJECT;
    console.log(`Tier: emulator (Firestore at ${EMULATOR_HOST}). Runs only *.emulator.test.ts suites.`);
    process.exit(runChunks("vitest", VITEST, ["run"], ["emulator"]));
  }

  if (tier === "full") {
    console.log("Tier: full. Entire Vitest suite, typecheck and lint.");
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      console.warn(
        "\nWARNING: FIRESTORE_EMULATOR_HOST is not set. The emulator suites will skip. " +
          "Run pnpm test:emulator separately before a release.",
      );
    }
    const steps = [
      run("vitest (full suite)", VITEST, ["run"]),
      run("typecheck", TSC, ["--noEmit"]),
      run("lint", ESLINT, []),
    ];
    process.exit(steps.find((s) => s !== 0) ?? 0);
  }

  // quick and standard
  const selection = mode === "changed" ? changedFiles() : resolveExplicit(explicitArgs);
  const guards = guardFiles();
  console.log(`Tier: ${tier}.`);
  printSelection(selection, guards);
  console.log(
    tier === "quick"
      ? "\nQUICK is task-scoped feedback only. It is not complete verification. See docs/TESTING.md §1a."
      : "\nSTANDARD is task-scoped verification with typecheck and lint of the selection. It is not the full suite.",
  );

  const steps = [];
  // One Vitest process: `vitest related` runs the tests that import the source files, and it also runs
  // any test file passed to it (checked: a test file argument runs itself). Startup is paid once.
  const selectedTests = [...new Set([...selection.tests])];
  if (tier === "standard") {
    const folders = featureFolders([...selection.tests, ...selection.sources]);
    for (const folder of folders) {
      for (const f of globSync(`${folder}/**/*.{test,spec}.{ts,tsx}`, { cwd: root }).map(toPosix)) {
        if (!selectedTests.includes(f)) selectedTests.push(f);
      }
    }
    if (folders.length > 0) console.log(`  feature folders added in full: ${folders.join(", ")}`);
  }
  const targets = [...new Set([...selection.sources, ...selectedTests, ...guards])];
  if (targets.length > 0) steps.push(runChunks("vitest related", VITEST, ["related", "--run"], targets));
  if (tier === "standard") {
    steps.push(run("typecheck", TSC, ["--noEmit"]));
    const lintable = [...selection.tests, ...selection.sources];
    if (lintable.length > 0) steps.push(runChunks("eslint", ESLINT, [], lintable));
  }

  if (steps.length === 0) {
    console.log("\nNothing selected. Nothing was verified.");
    process.exit(0);
  }
  process.exit(steps.find((s) => s !== 0) ?? 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

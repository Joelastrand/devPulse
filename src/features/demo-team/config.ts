import { assertValidPresenterUid } from "./fixtures";

/**
 * Pure CLI-argument and environment validation for the demo-team seed
 * (docs/features/demo-team/SPEC.md — "Target-project safety model", BR-1–BR-3,
 * BR-5, BR-6). argv, env and the clock are injected; there is no I/O, no
 * network and no Firebase import. The target project is never inferred: it is
 * always `--project`, and it must be proven against the explicit credential
 * trio before any later step may touch the network.
 *
 * Errors carry a category only. They never echo argument values, environment
 * values or credential material (BR-31).
 */

export type DemoSeedMode = "offline-dry-run" | "online-dry-run" | "write";

export interface DemoSeedCredentials {
  clientEmail: string;
  privateKey: string;
}

export interface DemoSeedConfig {
  mode: DemoSeedMode;
  /** The proven target project id (equals `--project` and `FIREBASE_PROJECT_ID`). */
  projectId: string;
  presenterUid: string;
  /** Midnight UTC of the as-of day. */
  asOf: Date;
  /** Capability the runner must honor: `false` means zero network calls and zero reads. */
  network: boolean;
  /** `true` only in `write` mode. Not coordinator approval (BR-4). */
  writesAllowed: boolean;
  /** Explicit service-account credentials for online modes; `null` offline. */
  credentials: DemoSeedCredentials | null;
}

export type DemoSeedConfigErrorCategory =
  | "unknown-flag"
  | "duplicate-flag"
  | "missing-flag"
  | "missing-value"
  | "unexpected-value"
  | "conflicting-flags"
  | "confirm-required"
  | "confirm-mismatch"
  | "invalid-project-id"
  | "invalid-presenter-uid"
  | "invalid-as-of"
  | "env-incomplete"
  | "project-mismatch"
  | "public-project-mismatch"
  | "service-account-mismatch";

export interface DemoSeedConfigError {
  category: DemoSeedConfigErrorCategory;
  /** Fixed flag/variable name when one applies; never a user-supplied value. */
  subject?: string;
}

export type DemoSeedConfigResult =
  | { ok: true; config: DemoSeedConfig }
  | { ok: false; error: DemoSeedConfigError };

export interface ResolveDemoSeedConfigInput {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
}

const VALUE_FLAGS = ["--project", "--presenter-uid", "--as-of", "--confirm"] as const;
const BOOLEAN_FLAGS = ["--offline", "--write"] as const;

type ValueFlag = (typeof VALUE_FLAGS)[number];
type BooleanFlag = (typeof BOOLEAN_FLAGS)[number];

interface ParsedArgs {
  values: Partial<Record<ValueFlag, string>>;
  booleans: Partial<Record<BooleanFlag, true>>;
}

type Parsed = { ok: true; args: ParsedArgs } | { ok: false; error: DemoSeedConfigError };

// GCP project ids: 6–30 chars, lowercase letters/digits/hyphens, letter first, no trailing hyphen.
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const AS_OF_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function fail(category: DemoSeedConfigErrorCategory, subject?: string): Parsed & { ok: false } {
  return { ok: false, error: subject === undefined ? { category } : { category, subject } };
}

function isValueFlag(flag: string): flag is ValueFlag {
  return (VALUE_FLAGS as readonly string[]).includes(flag);
}

function isBooleanFlag(flag: string): flag is BooleanFlag {
  return (BOOLEAN_FLAGS as readonly string[]).includes(flag);
}

function parseArgs(argv: readonly string[]): Parsed {
  const values: ParsedArgs["values"] = {};
  const booleans: ParsedArgs["booleans"] = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    // Positional arguments and a bare `--` are not part of the interface.
    if (!token.startsWith("--") || token === "--") return fail("unknown-flag");

    const equalsAt = token.indexOf("=");
    const flag = equalsAt === -1 ? token : token.slice(0, equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : token.slice(equalsAt + 1);

    if (isBooleanFlag(flag)) {
      if (inlineValue !== undefined) return fail("unexpected-value", flag);
      if (booleans[flag]) return fail("duplicate-flag", flag);
      booleans[flag] = true;
      continue;
    }

    if (!isValueFlag(flag)) return fail("unknown-flag");
    if (values[flag] !== undefined) return fail("duplicate-flag", flag);

    let value = inlineValue;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return fail("missing-value", flag);
      value = next;
      i += 1;
    }
    if (value === "") return fail("missing-value", flag);
    values[flag] = value;
  }

  return { ok: true, args: { values, booleans } };
}

/** Strict `YYYY-MM-DD` real calendar date → midnight UTC, or `null`. */
function parseAsOf(raw: string): Date | null {
  const match = AS_OF_PATTERN.exec(raw);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Round-trip rejects overflow such as 2031-02-30 or 2031-13-01.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
}

function isValidPresenterUid(uid: string): boolean {
  try {
    assertValidPresenterUid(uid);
    return true;
  } catch {
    return false;
  }
}

/** A present, non-blank value, or `undefined`. Blank is treated as unset. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

function isServiceAccountEmailFor(email: string, projectId: string): boolean {
  const suffix = `@${projectId}.iam.gserviceaccount.com`;
  if (!email.endsWith(suffix)) return false;
  const local = email.slice(0, email.length - suffix.length);
  return local.length > 0 && !local.includes("@");
}

export function resolveDemoSeedConfig(input: ResolveDemoSeedConfigInput): DemoSeedConfigResult {
  const parsed = parseArgs(input.argv);
  if (!parsed.ok) return parsed;
  const { values, booleans } = parsed.args;

  const projectId = values["--project"];
  if (projectId === undefined) return fail("missing-flag", "--project");
  const presenterUid = values["--presenter-uid"];
  if (presenterUid === undefined) return fail("missing-flag", "--presenter-uid");

  if (!PROJECT_ID_PATTERN.test(projectId)) return fail("invalid-project-id", "--project");
  if (!isValidPresenterUid(presenterUid)) return fail("invalid-presenter-uid", "--presenter-uid");

  let asOf: Date;
  if (values["--as-of"] === undefined) {
    asOf = startOfUtcDay(input.now());
  } else {
    const explicit = parseAsOf(values["--as-of"]);
    if (!explicit) return fail("invalid-as-of", "--as-of");
    asOf = explicit;
  }

  const offline = booleans["--offline"] === true;
  const write = booleans["--write"] === true;
  const confirm = values["--confirm"];

  if (write && offline) return fail("conflicting-flags", "--write");
  if (confirm !== undefined && !write) return fail("conflicting-flags", "--confirm");
  if (write && confirm === undefined) return fail("confirm-required", "--confirm");
  if (write && confirm !== projectId) return fail("confirm-mismatch", "--confirm");

  // Target proof (BR-2): runs in every mode, before any network is possible.
  const envProjectId = present(input.env.FIREBASE_PROJECT_ID);
  const clientEmail = present(input.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = present(input.env.FIREBASE_PRIVATE_KEY);
  if (envProjectId === undefined || clientEmail === undefined || privateKey === undefined) {
    return fail("env-incomplete");
  }

  if (envProjectId !== projectId) return fail("project-mismatch", "FIREBASE_PROJECT_ID");

  const publicProjectId = present(input.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  if (publicProjectId !== undefined && publicProjectId !== projectId) {
    return fail("public-project-mismatch", "NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  }

  if (!isServiceAccountEmailFor(clientEmail, projectId)) {
    return fail("service-account-mismatch", "FIREBASE_CLIENT_EMAIL");
  }

  const mode: DemoSeedMode = offline ? "offline-dry-run" : write ? "write" : "online-dry-run";

  return {
    ok: true,
    config: {
      mode,
      projectId,
      presenterUid,
      asOf,
      network: !offline,
      writesAllowed: write,
      credentials: offline ? null : { clientEmail, privateKey },
    },
  };
}

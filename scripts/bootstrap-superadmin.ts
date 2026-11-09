/**
 * One-time owner bootstrap for the superadmin registry. Run by hand, never at startup, never from CI, never from the app.
 *
 * Usage (from the repository root):
 *   node --env-file=.env.local scripts/bootstrap-superadmin.ts --project <firebase-project-id> --email <owner-email>
 *     -> dry run: prints the plan, writes nothing
 *   node --env-file=.env.local scripts/bootstrap-superadmin.ts --project <id> --email <owner-email> --apply --confirm <id>
 *     -> writes the single initial superadmin, only if the registry has no other active superadmin
 *
 * Safety:
 * - `--project` must equal the project this checkout is configured for (`FIREBASE_PROJECT_ID` or
 *   `NEXT_PUBLIC_FIREBASE_PROJECT_ID` from `.env.local`). Any other project is refused before a credential is used.
 * - Writing needs `--apply` AND `--confirm` with the same project id typed again.
 * - Credentials come from the same server-only variables as the app (`FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`) or
 *   Application Default Credentials. Nothing is printed except the plan, the outcome and the account UID.
 *
 * Exit codes: 0 granted / already superadmin / would grant (dry run); 1 refused; 2 usage or configuration error.
 */
import { pathToFileURL } from "node:url";
import { cert, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// ---- Pure bootstrap core (also exercised by bootstrap-superadmin.test.ts) ----
/**
 * Pure core of the one-time owner bootstrap (docs/features/superadmin-registry/SPEC.md, bootstrap). No Firebase import here:
 * the CLI (`bootstrap-superadmin.ts`) supplies the Auth lookup and the registry transaction through `BootstrapPorts`, so the
 * decision logic is unit-tested against an in-memory registry.
 *
 * Rules:
 * - The target is resolved through Firebase Auth by e-mail. An unknown, unverified or disabled account is refused. No account
 *   is ever created.
 * - Refused when any OTHER active superadmin exists, so a second initial superadmin can never be created by this script.
 * - Idempotent: when the target is already the one and only active superadmin with a consistent count, nothing is written.
 * - An inconsistent registry (count and records disagree, or the count is unreadable) is refused, never repaired silently.
 * - Dry run (`apply: false`) performs the same reads and reports the plan; it writes nothing.
 *
 * The registry shape must match src/features/superadmins/domain/superadmin-registry.ts (`superadmins/{uid}`,
 * `superadminRegistry/control`). The bootstrap test asserts the constants below.
 */

export const BOOTSTRAP_SUPERADMIN_COLLECTION = "superadmins";
export const BOOTSTRAP_CONTROL_COLLECTION = "superadminRegistry";
export const BOOTSTRAP_CONTROL_DOC_ID = "control";
/**
 * The bootstrap grant has no granting superadmin. `grantedByUid` is a UID field in the erasure inventory (A-16) and holds a
 * UID or null only, so the bootstrap writes null. Null means "granted by the owner bootstrap".
 */
export const BOOTSTRAP_GRANTED_BY_UID = null;

/** The first `superadmins/{uid}` record. Every UID-typed field holds a UID or null (SR-SI-11, erasure inventory A-16). */
export function buildInitialSuperadminRecord(uid: string, now: Date) {
  return {
    uid,
    active: true,
    grantedAt: now,
    grantedByUid: BOOTSTRAP_GRANTED_BY_UID,
    revokedAt: null,
    revokedByUid: null,
    updatedAt: now,
  };
}

export interface AuthUser {
  readonly uid: string;
  readonly emailVerified: boolean;
  readonly disabled: boolean;
}

/** Reads and the single write of one bootstrap transaction. All reads come before the write. */
export interface BootstrapTx {
  /** UIDs of every `superadmins` record with `active: true`. */
  readActiveUids(): Promise<readonly string[]>;
  /** `activeCount` from the control document: 0 when absent, `undefined` when malformed. */
  readActiveCount(): Promise<number | undefined>;
  /** Writes the target record and sets the count to 1. Called at most once, after every read. */
  writeInitialSuperadmin(uid: string, now: Date): void;
}

export interface BootstrapPorts {
  lookupUserByEmail(email: string): Promise<AuthUser | undefined>;
  runTransaction<T>(work: (tx: BootstrapTx) => Promise<T>): Promise<T>;
}

export type BootstrapRefusal =
  | "invalid_email"
  | "target_not_found"
  | "target_unverified"
  | "target_disabled"
  | "initial_superadmin_exists"
  | "registry_inconsistent";

export type BootstrapReport =
  | { readonly ok: true; readonly status: "would_grant"; readonly uid: string }
  | { readonly ok: true; readonly status: "granted"; readonly uid: string }
  | { readonly ok: true; readonly status: "already_superadmin"; readonly uid: string }
  | { readonly ok: false; readonly refusal: BootstrapRefusal };

export interface BootstrapOptions {
  readonly email: string;
  readonly apply: boolean;
  readonly now: Date;
}

export async function bootstrapSuperadmin(ports: BootstrapPorts, options: BootstrapOptions): Promise<BootstrapReport> {
  const email = options.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return { ok: false, refusal: "invalid_email" };

  const user = await ports.lookupUserByEmail(email);
  if (user === undefined) return { ok: false, refusal: "target_not_found" };
  if (!user.emailVerified) return { ok: false, refusal: "target_unverified" };
  if (user.disabled) return { ok: false, refusal: "target_disabled" };

  return ports.runTransaction(async (tx): Promise<BootstrapReport> => {
    const activeUids = await tx.readActiveUids();
    const activeCount = await tx.readActiveCount();
    if (activeCount === undefined) return { ok: false, refusal: "registry_inconsistent" };

    const others = activeUids.filter((uid) => uid !== user.uid);
    if (others.length > 0) return { ok: false, refusal: "initial_superadmin_exists" };

    const targetIsActive = activeUids.includes(user.uid);
    if (targetIsActive) {
      return activeCount === 1
        ? { ok: true, status: "already_superadmin", uid: user.uid }
        : { ok: false, refusal: "registry_inconsistent" };
    }
    if (activeCount !== 0) return { ok: false, refusal: "registry_inconsistent" };

    if (!options.apply) return { ok: true, status: "would_grant", uid: user.uid };
    tx.writeInitialSuperadmin(user.uid, options.now);
    return { ok: true, status: "granted", uid: user.uid };
  });
}


interface Args {
  readonly project?: string;
  readonly email?: string;
  readonly apply: boolean;
  readonly confirm?: string;
}

function parseArgs(argv: readonly string[]): Args | string {
  const values: { project?: string; email?: string; confirm?: string; apply: boolean } = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      values.apply = true;
      continue;
    }
    const next = argv[index + 1];
    if (arg === "--project" || arg === "--email" || arg === "--confirm") {
      if (next === undefined || next.startsWith("--")) return `missing value for ${arg}`;
      if (arg === "--project") values.project = next;
      if (arg === "--email") values.email = next;
      if (arg === "--confirm") values.confirm = next;
      index += 1;
      continue;
    }
    return `unknown argument ${arg}`;
  }
  return values;
}

/**
 * The configured project. When both variables are set they must agree; a disagreement is ambiguous, so it returns `conflict`
 * and the script refuses to run.
 */
function configuredProjectId(): { readonly projectId?: string; readonly conflict: boolean } {
  const admin = process.env.FIREBASE_PROJECT_ID || undefined;
  const client = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || undefined;
  if (admin !== undefined && client !== undefined && admin !== client) return { conflict: true };
  return { projectId: admin ?? client, conflict: false };
}

function initAdmin(projectId: string) {
  const existing = getApps()[0];
  if (existing) return existing;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (process.env.FIREBASE_PROJECT_ID && clientEmail && privateKey) {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
  }
  return initializeApp({ credential: applicationDefault(), projectId });
}

function firebasePorts(projectId: string): BootstrapPorts {
  const app = initAdmin(projectId);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const superadmins = db.collection(BOOTSTRAP_SUPERADMIN_COLLECTION);
  const control = db.collection(BOOTSTRAP_CONTROL_COLLECTION).doc(BOOTSTRAP_CONTROL_DOC_ID);

  return {
    async lookupUserByEmail(email) {
      try {
        const user = await auth.getUserByEmail(email);
        return { uid: user.uid, emailVerified: user.emailVerified, disabled: user.disabled };
      } catch (error) {
        if ((error as { code?: unknown }).code === "auth/user-not-found") return undefined;
        throw error;
      }
    },
    runTransaction(work) {
      return db.runTransaction((tx) =>
        work({
          async readActiveUids() {
            const snapshot = await tx.get(superadmins.where("active", "==", true));
            return snapshot.docs.map((doc) => doc.id);
          },
          async readActiveCount() {
            const snapshot = await tx.get(control);
            if (!snapshot.exists) return 0;
            const count = snapshot.data()?.activeCount;
            return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
          },
          writeInitialSuperadmin(uid, now) {
            tx.set(superadmins.doc(uid), buildInitialSuperadminRecord(uid, now));
            tx.set(control, { activeCount: 1, updatedAt: now });
          },
        }),
      );
    },
  };
}

function describeReport(report: BootstrapReport): string {
  if (!report.ok) return `REFUSED: ${report.refusal}`;
  switch (report.status) {
    case "would_grant":
      return `DRY RUN: would grant superadmin to uid ${report.uid}. Re-run with --apply --confirm <project> to write.`;
    case "granted":
      return `GRANTED: superadmin granted to uid ${report.uid}.`;
    case "already_superadmin":
      return `NO CHANGE: uid ${report.uid} is already the only active superadmin.`;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    console.error(`bootstrap-superadmin: ${parsed}`);
    return 2;
  }
  if (!parsed.project || !parsed.email) {
    console.error("usage: --project <firebase-project-id> --email <owner-email> [--apply --confirm <firebase-project-id>]");
    return 2;
  }

  const { projectId: configured, conflict } = configuredProjectId();
  if (conflict) {
    console.error("bootstrap-superadmin: FIREBASE_PROJECT_ID and NEXT_PUBLIC_FIREBASE_PROJECT_ID disagree. Refusing.");
    return 2;
  }
  if (configured === undefined) {
    console.error("bootstrap-superadmin: FIREBASE_PROJECT_ID is not set; refusing to run without a configured project.");
    return 2;
  }
  if (parsed.project !== configured) {
    console.error(`bootstrap-superadmin: --project (${parsed.project}) does not match the configured project. Refusing.`);
    return 2;
  }
  if (parsed.apply && parsed.confirm !== parsed.project) {
    console.error("bootstrap-superadmin: --apply requires --confirm with the same project id. Nothing written.");
    return 2;
  }

  console.log(`project: ${parsed.project}`);
  console.log(`mode: ${parsed.apply ? "APPLY" : "dry run"}`);
  const report = await bootstrapSuperadmin(firebasePorts(parsed.project), {
    email: parsed.email,
    apply: parsed.apply,
    now: new Date(),
  });
  console.log(describeReport(report));
  if (!report.ok) return 1;
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

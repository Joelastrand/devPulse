import { SIMULATED_CONTRIBUTION_TEAM_ID } from "../../team-skills/domain/skill-contribution";
import { normalizePrivateKey } from "../adapters";
import { demoCrypto } from "../crypto";
import { runLocalCryptoPreflight } from "../preflight";
import { bindAdminFirestore } from "./firestore-binding";
import { runTeamkompetanseSeed } from "./live";

/**
 * Process boundary for `pnpm seed:demo-teamkompetanse`. Every gate runs before any Firestore call: explicit project and
 * team arguments, the environment project, a key check and the crypto round-trip. Prints only category strings and counts.
 * Never prints environment values, identifiers beyond the fixed fictional uids, or raw SDK errors.
 */

const REQUIRED_PROJECT_ID = "devpulse-nve";
const APP_NAME = "demo-teamkompetanse-seed";

interface CliArgs {
  mode: "preflight" | "write";
  project: string;
  team: string;
}

function parseArgs(argv: readonly string[]): CliArgs | null {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const mode = value("--mode");
  const project = value("--project");
  const team = value("--team");
  if ((mode !== "preflight" && mode !== "write") || !project || !team) return null;
  return { mode, project, team };
}

function fail(category: string): void {
  process.stderr.write(`Aborted: ${category} (nothing was written)\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    process.stderr.write(`Usage: --mode preflight|write --project devpulse-nve --team ${SIMULATED_CONTRIBUTION_TEAM_ID}\n`);
    process.exitCode = 2;
    return;
  }
  if (args.project !== REQUIRED_PROJECT_ID || args.team !== SIMULATED_CONTRIBUTION_TEAM_ID) return fail("argument-mismatch");
  if (!runLocalCryptoPreflight(demoCrypto)) return fail("crypto-failed");

  const env = process.env;
  const projectId = env.FIREBASE_PROJECT_ID;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return fail("credentials-missing");
  if (projectId !== args.project) return fail("project-env-mismatch");

  const adminApp = await import("firebase-admin/app");
  const firestore = await import("firebase-admin/firestore");
  const authSdk = await import("firebase-admin/auth");
  const app = adminApp.initializeApp(
    { credential: adminApp.cert({ projectId, clientEmail, privateKey: normalizePrivateKey(privateKey) }), projectId },
    APP_NAME,
  );
  const db = firestore.getFirestore(app);
  const auth = authSdk.getAuth(app);

  const report = await runTeamkompetanseSeed({
    mode: args.mode,
    requiredProjectId: REQUIRED_PROJECT_ID,
    projectId,
    teamId: args.team,
    db: bindAdminFirestore(db),
    auth: {
      getUser: async (uid) => {
        const record = await auth.getUser(uid);
        return { uid: record.uid, disabled: record.disabled === true };
      },
    },
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

void main().catch(() => fail("internal-error"));

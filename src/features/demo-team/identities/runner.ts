import { resolveDemoSeedConfig, type DemoSeedConfig, type DemoSeedCredentials } from "../config";
import { runLocalCryptoPreflight, type DemoCrypto } from "../preflight";
import { openUserProfileDocument, toPersistedUserProfile } from "../../profiles/domain/user-profile-content-codec";
import { membershipDocId } from "../../teams/domain/team-membership";
import { DEMO_MEMBER_IDENTITIES, buildIdentityAuthRequest, buildIdentityMembership, validateDemoMemberIdentities, type DemoMemberIdentity } from "./fixtures";
import { identityMembershipPath, planIdentityProvisioning, verifyTargetTeam, type IdentityProvisioningPlan, type ObservedIdentity } from "./plan";
import type { IdentityOnlineAdapters } from "./adapters";

/**
 * Runner for `pnpm seed:demo-team-identities` (Phase C, step 2). Same argv/env gates as the team seed (`resolveDemoSeedConfig`:
 * explicit `--project`, `--presenter-uid`, `--confirm=<projectId>` and the explicit credential trio), then:
 *
 *   1. offline: validate the fixtures only (no network, no clock beyond `--as-of`).
 *   2. online: read-only observation of Auth (by uid and e-mail), the target team, the presenter's membership, and the
 *      fictional members' membership and profile documents. Nothing is written.
 *   3. any conflict aborts before a write; the plan is printed either way.
 *   4. write (only with `--write --confirm=<projectId>` and a conflict-free plan): Auth accounts are created one at a
 *      time FIRST, so a membership never points at a missing account; then ONE create-only Firestore batch for the
 *      memberships and profiles that were observed absent.
 *
 * Partial completion: Auth creation and Firestore are not one transaction. If a run stops after some Auth accounts were
 * created, the next run observes them as exact matches (`skip`) and creates only what is still missing. If the Firestore
 * batch fails, it wrote nothing, and the next run creates all memberships and profiles. Nothing is ever deleted,
 * overwritten or updated, and the presenter's records are read only.
 */

export interface IdentityRunnerInput {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  crypto: DemoCrypto;
  createOnlineAdapters: (target: { projectId: string; credentials: DemoSeedCredentials }) => Promise<IdentityOnlineAdapters>;
  identities?: readonly DemoMemberIdentity[];
}

export interface IdentityRunnerOutput {
  exitCode: 0 | 1 | 2;
  stdout: string[];
  stderr: string[];
}

function abort(stdout: string[], category: string, exitCode: 1 | 2 = 1): IdentityRunnerOutput {
  return { exitCode, stdout, stderr: [`Aborted: ${category} (nothing further was written)`] };
}

function formatCounts(plan: IdentityProvisioningPlan): string[] {
  const line = (label: string, c: Record<"create" | "skip" | "conflict", number>) =>
    `${label}: create ${c.create}, skip ${c.skip}, conflict ${c.conflict}`;
  return [
    line("Auth accounts (disabled, no password)", plan.counts.auth),
    line("teamMemberships", plan.counts.membership),
    line("userProfiles", plan.counts.profile),
  ];
}

function conflictLines(plan: IdentityProvisioningPlan): string[] {
  return plan.items.flatMap((item) =>
    (["auth", "membership", "profile"] as const)
      .filter((kind) => item[kind].action === "conflict")
      .map((kind) => `Conflict: ${item.uid} ${kind} (${item[kind].reason ?? "unknown"})`),
  );
}

/** Observes one member's existing records. Read-only. Unreadable profiles are `null` (a conflict), never fabricated. */
async function observe(
  identity: DemoMemberIdentity,
  teamId: string,
  adapters: IdentityOnlineAdapters,
  crypto: DemoCrypto,
): Promise<ObservedIdentity> {
  const [accountById, accountByMail, membership, profile] = await Promise.all([
    adapters.accountById(identity.uid),
    adapters.accountByMail(identity.email),
    adapters.readDoc(identityMembershipPath(identity.uid, teamId)),
    adapters.readDoc(`userProfiles/${identity.uid}`),
  ]);

  let profileName: string | null | undefined;
  if (!profile.exists) {
    profileName = undefined;
  } else {
    const opened = openUserProfileDocument(identity.uid, profile.data, (envelope, context) => crypto.openRecord(envelope, context));
    const displayName = typeof opened === "object" && opened !== null ? (opened as { displayName?: unknown }).displayName : undefined;
    profileName = typeof displayName === "string" ? displayName : null;
  }

  return {
    accountById,
    accountByMail,
    membershipRaw: membership.exists ? membership.data : undefined,
    profileName,
  };
}

export async function runIdentityProvisioning(input: IdentityRunnerInput): Promise<IdentityRunnerOutput> {
  const resolved = resolveDemoSeedConfig({ argv: input.argv, env: input.env, now: input.now });
  if (!resolved.ok) {
    const { category, subject } = resolved.error;
    return {
      exitCode: 2,
      stdout: [],
      stderr: [`Configuration error: ${category}${subject === undefined ? "" : ` (${subject})`}`],
    };
  }
  const config: DemoSeedConfig = resolved.config;
  const identities = input.identities ?? DEMO_MEMBER_IDENTITIES;

  const problems = validateDemoMemberIdentities(identities, config.presenterUid);
  if (problems.length > 0) {
    return abort([], "fixtures-invalid");
  }
  if (!runLocalCryptoPreflight(input.crypto)) {
    return abort([], "crypto-failed");
  }

  const header = [
    `Project: ${config.projectId} (verified against FIREBASE_PROJECT_ID)`,
    `Team: ${config.teamId}`,
    `Fictional members: ${identities.length} (fixtures valid)`,
  ];

  if (config.mode === "offline-dry-run") {
    return {
      exitCode: 0,
      stdout: [
        ...header,
        "Mode: offline (no network, no reads, no writes). Run with the live flags for a read-only preflight.",
      ],
      stderr: [],
    };
  }

  // Online modes only from here. Adapters are built after the config gate, never offline.
  if (config.credentials === null) return abort([], "adapters-missing");
  let adapters: IdentityOnlineAdapters;
  try {
    adapters = await input.createOnlineAdapters({ projectId: config.projectId, credentials: config.credentials });
  } catch {
    return abort([], "adapters-failed");
  }

  // Target-team and presenter verification (read-only). The presenter must already be the team's teamadmin.
  let verified;
  try {
    const team = await adapters.readDoc(`teams/${config.teamId}`);
    const presenterMembership = await adapters.readDoc(`teamMemberships/${membershipDocId(config.presenterUid, config.teamId)}`);
    const presenterAuth = await adapters.presenterAuthExists(config.presenterUid);
    if (!presenterAuth) return abort(header, "presenter-missing");
    verified = verifyTargetTeam({
      teamId: config.teamId,
      presenterUid: config.presenterUid,
      teamExists: team.exists,
      presenterMembershipRaw: presenterMembership.exists ? presenterMembership.data : undefined,
    });
  } catch {
    return abort(header, "preflight-failed");
  }
  if (!verified.ok) return abort(header, verified.reason);

  let observed: Map<string, ObservedIdentity>;
  try {
    const entries = await Promise.all(
      identities.map(async (identity) => [identity.uid, await observe(identity, config.teamId, adapters, input.crypto)] as const),
    );
    observed = new Map(entries);
  } catch {
    return abort(header, "preflight-failed");
  }

  const plan = planIdentityProvisioning({ identities, teamId: config.teamId, observed });
  const lines = [...header, ...formatCounts(plan)];
  if (!plan.noConflicts) {
    return abort([...lines, ...conflictLines(plan)], "conflicts-found");
  }
  if (config.mode !== "write") {
    return { exitCode: 0, stdout: [...lines, "Dry run: nothing written."], stderr: [] };
  }
  if (!config.writesAllowed) return abort(lines, "write-gate-not-satisfied");

  const authToCreate = plan.items.filter((item) => item.auth.action === "create");
  const docsToCreate = plan.items.flatMap((item) => {
    const identity = identities.find((candidate) => candidate.uid === item.uid);
    if (identity === undefined) return [];
    const ops: Array<{ path: string; data: unknown }> = [];
    if (item.membership.action === "create") {
      ops.push({ path: identityMembershipPath(identity.uid, config.teamId), data: buildIdentityMembership(identity, config.teamId, config.asOf) });
    }
    if (item.profile.action === "create") {
      // The uid is the document id and is not stored as a field; the display name is sealed by the profile codec.
      ops.push({
        path: `userProfiles/${identity.uid}`,
        data: toPersistedUserProfile(
          identity.uid,
          { displayName: identity.fullName, createdAt: config.asOf, updatedAt: config.asOf },
          input.crypto.sealRecord,
        ),
      });
    }
    return ops;
  });

  if (authToCreate.length === 0 && docsToCreate.length === 0) {
    return { exitCode: 0, stdout: [...lines, "Write: nothing to write; every fictional member already matches the fixtures."], stderr: [] };
  }

  // Auth first: a membership or profile never refers to an account that does not exist yet.
  let createdAuth = 0;
  for (const item of authToCreate) {
    const identity = identities.find((candidate) => candidate.uid === item.uid);
    if (identity === undefined) return abort(lines, "fixtures-invalid");
    try {
      await adapters.createAuthAccount(buildIdentityAuthRequest(identity));
      createdAuth += 1;
    } catch {
      return abort(
        [...lines, `Write: created ${createdAuth} of ${authToCreate.length} Auth accounts before failing. Rerun the same command to resume.`],
        "auth-create-failed",
      );
    }
  }

  try {
    const batch = adapters.createBatch();
    for (const op of docsToCreate) batch.create(op.path, op.data);
    await batch.commit();
  } catch {
    return abort(
      [...lines, `Write: ${createdAuth} Auth accounts created; the Firestore batch failed and wrote nothing. Rerun the same command to resume.`],
      "firestore-write-failed",
    );
  }

  return {
    exitCode: 0,
    stdout: [
      ...lines,
      `Write: created ${createdAuth} disabled Auth accounts; committed ${docsToCreate.length} Firestore documents in one batch. Deletes: 0`,
    ],
    stderr: [],
  };
}


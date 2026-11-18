import { resolveDemoSeedConfig, type DemoSeedConfig, type DemoSeedCredentials } from "../config";
import { runLocalCryptoPreflight, type DemoCrypto } from "../preflight";
import { membershipDocId } from "../../teams/domain/team-membership";
import { verifyTargetTeam } from "../identities/plan";
import { roadmapItemDocId } from "../../roadmap/domain/roadmap-item";
import type { ObservedMembership, ObservedRoadmapItem } from "./plan";
import { planOwnerAssignments, type OwnerAssignment, type OwnerProvisioningPlan } from "./owners-plan";
import type { RoadmapOnlineAdapters, RoadmapTx } from "./adapters";

/**
 * Runner for `pnpm seed:demo-team-roadmap-owners` (Phase E2). Assigns an owner to the three original roadmap plans and nothing
 * else. Same argv and env gates as the other demo seeds, then:
 *
 *   1. offline: report the assignments only.
 *   2. online, ONE transaction: read the team, the presenter's membership, the owners' memberships and erasure records, the
 *      team's memberships (memberRef uniqueness) and the three roadmap documents. Plan from those reads. Writes are queued and
 *      applied only after every read, so they commit together or not at all.
 *   3. write (only with `--write --confirm=<projectId>` and a conflict-free plan): field-level updates of the owner fields
 *      (`content`, `ownerRefIndex`, `updatedAt`, `updatedBy`) on the roadmap documents that have no owner. Nothing else is set.
 *
 * Rerunning after success is a no-op: every plan is already owned by the same memberRef and is skipped.
 */

/** The owners the user authorized for the original plans. Reviewed here, never derived from a uid or an e-mail. */
export const DEMO_ROADMAP_OWNER_ASSIGNMENTS: readonly OwnerAssignment[] = Object.freeze([
  { treeId: "demo-skill-observability", ownerUid: "demo-member-08" },
  { treeId: "demo-skill-delivery", ownerUid: "demo-member-10" },
  { treeId: "demo-skill-testing", ownerUid: "demo-member-03" },
]);

export interface OwnerRunnerInput {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  crypto: DemoCrypto;
  createOnlineAdapters: (target: { projectId: string; credentials: DemoSeedCredentials }) => Promise<RoadmapOnlineAdapters>;
  assignments?: readonly OwnerAssignment[];
}

export interface OwnerRunnerOutput {
  exitCode: 0 | 1 | 2;
  stdout: string[];
  stderr: string[];
}

function abort(stdout: string[], category: string): OwnerRunnerOutput {
  return { exitCode: 1, stdout, stderr: [`Aborted: ${category} (nothing further was written)`] };
}

function formatPlan(plan: OwnerProvisioningPlan): string[] {
  const c = plan.counts;
  return [`roadmapItems owner: update ${c.update}, skip ${c.skip}, conflict ${c.conflict}`];
}

function conflictLines(plan: OwnerProvisioningPlan): string[] {
  return plan.entries
    .filter((e) => e.action === "conflict")
    .map((e) => `Conflict: roadmapItems/${e.docId} (${e.reason ?? "unknown"})`);
}

type TransactionResult =
  | { kind: "aborted"; header: string[]; category: string }
  | { kind: "planned"; header: string[]; plan: OwnerProvisioningPlan };

export async function runOwnerAssignments(input: OwnerRunnerInput): Promise<OwnerRunnerOutput> {
  const resolved = resolveDemoSeedConfig({ argv: input.argv, env: input.env, now: input.now });
  if (!resolved.ok) {
    const { category, subject } = resolved.error;
    return { exitCode: 2, stdout: [], stderr: [`Configuration error: ${category}${subject === undefined ? "" : ` (${subject})`}`] };
  }
  const config: DemoSeedConfig = resolved.config;
  const assignments = input.assignments ?? DEMO_ROADMAP_OWNER_ASSIGNMENTS;

  if (!runLocalCryptoPreflight(input.crypto)) return abort([], "crypto-failed");

  const header = [
    `Project: ${config.projectId} (verified against FIREBASE_PROJECT_ID)`,
    `Team: ${config.teamId}`,
    `Owner assignments: ${assignments.length}`,
  ];

  if (config.mode === "offline-dry-run") {
    return {
      exitCode: 0,
      stdout: [...header, "Mode: offline (no network, no reads, no writes). Run with the live flags for a read-only preflight."],
      stderr: [],
    };
  }

  if (config.credentials === null) return abort([], "adapters-missing");
  let adapters: RoadmapOnlineAdapters;
  try {
    adapters = await input.createOnlineAdapters({ projectId: config.projectId, credentials: config.credentials });
  } catch {
    return abort([], "adapters-failed");
  }

  const writesRequested = config.mode === "write" && config.writesAllowed;
  const crypto = input.crypto;
  const ownerUids = [...new Set(assignments.map((a) => a.ownerUid))];

  let result: TransactionResult;
  try {
    result = await adapters.runTransaction(async (tx: RoadmapTx): Promise<TransactionResult> => {
      const team = await tx.get(`teams/${config.teamId}`);
      const presenterMembership = await tx.get(`teamMemberships/${membershipDocId(config.presenterUid, config.teamId)}`);
      const verified = verifyTargetTeam({
        teamId: config.teamId,
        presenterUid: config.presenterUid,
        teamExists: team.exists,
        presenterMembershipRaw: presenterMembership.exists ? presenterMembership.data : undefined,
      });
      if (!verified.ok) return { kind: "aborted", header, category: verified.reason };

      const members = new Map<string, ObservedMembership>();
      const erasing = new Set<string>();
      for (const uid of ownerUids) {
        const membership = await tx.get(`teamMemberships/${membershipDocId(uid, config.teamId)}`);
        members.set(uid, { membership: membership.exists ? membership.data : undefined });
        if ((await tx.get(`accountErasures/${uid}`)).exists) erasing.add(uid);
      }
      const teamMemberships = await tx.queryTeamMemberships(config.teamId);

      const roadmapItems = new Map<string, ObservedRoadmapItem>();
      for (const assignment of assignments) {
        const docId = roadmapItemDocId(config.teamId, assignment.treeId);
        const doc = await tx.get(`roadmapItems/${docId}`);
        roadmapItems.set(docId, { raw: doc.exists ? doc.data : undefined });
      }

      const plan = planOwnerAssignments({
        teamId: config.teamId,
        now: input.now(),
        assignments,
        members,
        teamMemberships,
        erasing,
        roadmapItems,
        openRecord: crypto.openRecord,
        sealRecord: crypto.sealRecord,
      });
      if (!plan.noConflicts || !writesRequested) return { kind: "planned", header, plan };

      for (const entry of plan.entries) {
        if (entry.action === "update" && entry.fields !== undefined) {
          tx.updateOwnerFields(`roadmapItems/${entry.docId}`, { ...entry.fields });
        }
      }
      return { kind: "planned", header, plan };
    });
  } catch {
    return abort(header, "transaction-failed");
  }

  if (result.kind === "aborted") return abort(result.header, result.category);
  const { plan } = result;
  const lines = [...result.header, ...formatPlan(plan)];
  if (!plan.noConflicts) return abort([...lines, ...conflictLines(plan)], "conflicts-found");
  if (!writesRequested) {
    if (config.mode === "write" && !config.writesAllowed) return abort(lines, "write-gate-not-satisfied");
    return { exitCode: 0, stdout: [...lines, "Dry run: nothing written."], stderr: [] };
  }
  if (plan.counts.update === 0) return { exitCode: 0, stdout: [...lines, "Write: nothing to write; every owner already matches."], stderr: [] };
  return {
    exitCode: 0,
    stdout: [...lines, `Write: set owner on ${plan.counts.update} roadmap plans (field-level: owner fields only). One transaction. Creates: 0. Deletes: 0.`],
    stderr: [],
  };
}

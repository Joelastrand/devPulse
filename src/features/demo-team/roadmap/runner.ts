import { resolveDemoSeedConfig, type DemoSeedConfig, type DemoSeedCredentials } from "../config";
import { runLocalCryptoPreflight, type DemoCrypto } from "../preflight";
import { membershipDocId } from "../../teams/domain/team-membership";
import { verifyTargetTeam } from "../identities/plan";
import { roadmapItemDocId } from "../../roadmap/domain/roadmap-item";
import { DEMO_ROADMAP_EXPANSION, validateDemoRoadmapExpansion, type DemoRoadmapPlan } from "./fixtures";
import { planRoadmapExpansion, type ObservedMembership, type ObservedRoadmapItem, type RoadmapProvisioningPlan } from "./plan";
import type { RoadmapOnlineAdapters, RoadmapTx } from "./adapters";

/**
 * Runner for `pnpm seed:demo-team-roadmap` (Phase E). Same argv and env gates as the other demo seeds, then:
 *
 *   1. offline: validate the roadmap expansion fixtures only.
 *   2. online, ONE transaction: read the team, the presenter's membership, the owners' memberships and erasure records, the
 *      team's memberships (memberRef uniqueness), the skill trees of the plans, and the plan documents. Plan from those reads.
 *      Writes are queued and applied only after every read, so they commit together or not at all. A conflict aborts with no write.
 *   3. write (only with `--write --confirm=<projectId>` and a conflict-free plan): create-only writes of the missing
 *      `roadmapItems` documents. Nothing else is touched.
 *
 * A dry run runs the same reads and plan without any write. Rerunning after success is a no-op (every plan is skipped).
 */

export interface RoadmapRunnerInput {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  crypto: DemoCrypto;
  createOnlineAdapters: (target: { projectId: string; credentials: DemoSeedCredentials }) => Promise<RoadmapOnlineAdapters>;
  plans?: readonly DemoRoadmapPlan[];
}

export interface RoadmapRunnerOutput {
  exitCode: 0 | 1 | 2;
  stdout: string[];
  stderr: string[];
}

function abort(stdout: string[], category: string): RoadmapRunnerOutput {
  return { exitCode: 1, stdout, stderr: [`Aborted: ${category} (nothing further was written)`] };
}

function formatPlan(plan: RoadmapProvisioningPlan): string[] {
  const c = plan.counts;
  return [`roadmapItems: create ${c.create}, skip ${c.skip}, conflict ${c.conflict}`];
}

function conflictLines(plan: RoadmapProvisioningPlan): string[] {
  return plan.entries.filter((e) => e.action === "conflict").map((e) => `Conflict: roadmapItems/${e.docId} (${e.reason ?? "unknown"})`);
}

type TransactionResult =
  | { kind: "aborted"; header: string[]; category: string }
  | { kind: "planned"; header: string[]; plan: RoadmapProvisioningPlan };

export async function runRoadmapProvisioning(input: RoadmapRunnerInput): Promise<RoadmapRunnerOutput> {
  const resolved = resolveDemoSeedConfig({ argv: input.argv, env: input.env, now: input.now });
  if (!resolved.ok) {
    const { category, subject } = resolved.error;
    return { exitCode: 2, stdout: [], stderr: [`Configuration error: ${category}${subject === undefined ? "" : ` (${subject})`}`] };
  }
  const config: DemoSeedConfig = resolved.config;
  const plans = input.plans ?? DEMO_ROADMAP_EXPANSION;

  if (validateDemoRoadmapExpansion(plans).length > 0) return abort([], "fixtures-invalid");
  if (!runLocalCryptoPreflight(input.crypto)) return abort([], "crypto-failed");

  const header = [
    `Project: ${config.projectId} (verified against FIREBASE_PROJECT_ID)`,
    `Team: ${config.teamId}`,
    `Roadmap fixtures: ${plans.length} (fixtures valid)`,
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
  const ownerUids = [...new Set(plans.map((p) => p.ownerUid))];
  const treeIds = [...new Set(plans.map((p) => p.treeId))];

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
        const erasure = await tx.get(`accountErasures/${uid}`);
        if (erasure.exists) erasing.add(uid);
      }
      const teamMemberships = await tx.queryTeamMemberships(config.teamId);

      const skillTrees = new Map<string, boolean>();
      for (const treeId of treeIds) {
        skillTrees.set(treeId, (await tx.get(`skillTrees/${treeId}`)).exists);
      }

      const roadmapItems = new Map<string, ObservedRoadmapItem>();
      for (const plan of plans) {
        const docId = roadmapItemDocId(config.teamId, plan.treeId);
        const doc = await tx.get(`roadmapItems/${docId}`);
        roadmapItems.set(docId, { raw: doc.exists ? doc.data : undefined });
      }

      const plan = planRoadmapExpansion({
        teamId: config.teamId,
        now: input.now(),
        plans,
        members,
        teamMemberships,
        erasing,
        skillTrees,
        roadmapItems,
        openRecord: crypto.openRecord,
        sealRecord: crypto.sealRecord,
      });
      if (!plan.noConflicts || !writesRequested) return { kind: "planned", header, plan };

      // Create-only: a document that appeared meanwhile fails the whole transaction instead of being overwritten.
      for (const entry of plan.entries) {
        if (entry.action === "create" && entry.persisted !== undefined) {
          tx.create(`roadmapItems/${entry.docId}`, entry.persisted);
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
  const toCreate = plan.counts.create;
  if (toCreate === 0) return { exitCode: 0, stdout: [...lines, "Write: nothing to write; every roadmap plan already matches."], stderr: [] };
  return {
    exitCode: 0,
    stdout: [...lines, `Write: created ${toCreate} roadmap plans (create-only). One transaction. Updates: 0. Deletes: 0.`],
    stderr: [],
  };
}

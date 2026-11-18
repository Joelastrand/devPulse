import { resolveDemoSeedConfig, type DemoSeedConfig, type DemoSeedCredentials } from "../config";
import { runLocalCryptoPreflight, type DemoCrypto } from "../preflight";
import { generateMemberRef } from "../../teams/domain/member-ref";
import { membershipDocId } from "../../teams/domain/team-membership";
import { openTeamProjectDocument } from "../../team-projects/server/team-project-codec";
import { parseStoredTeamProject } from "../../team-projects/domain/team-project";
import { DEMO_MEMBER_IDENTITIES } from "../identities/fixtures";
import { verifyTargetTeam } from "../identities/plan";
import { DEMO_PARTICIPATIONS, validateDemoParticipations, type DemoParticipation } from "./fixtures";
import {
  participationDocumentFor,
  planParticipationProvisioning,
  type ObservedMember,
  type ObservedProject,
  type ParticipationProvisioningPlan,
  type ParticipationObservation,
} from "./plan";
import type { ParticipationOnlineAdapters, ParticipationTx } from "./adapters";

/**
 * Runner for `pnpm seed:demo-team-participations` (Phase D). Same argv and env gates as the team seed, then:
 *
 *   1. offline: validate the participation fixtures only.
 *   2. online, ONE transaction: read the team, the presenter's teamadmin membership, the 10 fictional memberships, the team's
 *      memberships (for memberRef uniqueness), the erasure records of those 10 members, the six projects and the fixture
 *      participation documents. Plan from those reads. Writes are queued and only applied after every read, so they commit
 *      together or not at all. A conflict aborts with no write.
 *   3. write (only with `--write --confirm=<projectId>` and a conflict-free plan): a field-level update setting `memberRef`
 *      on memberships that lack one, and create-only writes of the missing participations. Nothing else is touched.
 *
 * A dry run runs the same reads and plan without any write. Rerunning after success is a no-op.
 */

export interface ParticipationRunnerInput {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  now: () => Date;
  crypto: DemoCrypto;
  createOnlineAdapters: (target: { projectId: string; credentials: DemoSeedCredentials }) => Promise<ParticipationOnlineAdapters>;
  fixtures?: readonly DemoParticipation[];
  /** Test seam for the memberRef generator. Production uses the CSPRNG generator. */
  createKey?: () => string;
}

export interface ParticipationRunnerOutput {
  exitCode: 0 | 1 | 2;
  stdout: string[];
  stderr: string[];
}

function abort(stdout: string[], category: string): ParticipationRunnerOutput {
  return { exitCode: 1, stdout, stderr: [`Aborted: ${category} (nothing further was written)`] };
}

function formatPlan(plan: ParticipationProvisioningPlan): string[] {
  const c = plan.counts;
  return [
    `memberRef (memberships): keep ${c.memberRef.keep}, materialize ${c.memberRef.materialize}, conflict ${c.memberRef.conflict}`,
    `teamProjectParticipations: create ${c.participation.create}, skip ${c.participation.skip}, conflict ${c.participation.conflict}`,
  ];
}

function conflictLines(plan: ParticipationProvisioningPlan): string[] {
  return [
    ...plan.members.filter((m) => m.action === "conflict").map((m) => `Conflict: teamMemberships/${m.uid} (${m.reason ?? "unknown"})`),
    ...plan.participations
      .filter((p) => p.action === "conflict")
      .map((p) => `Conflict: teamProjectParticipations/${p.participationId} (${p.reason ?? "unknown"})`),
  ];
}

type TransactionResult =
  | { kind: "aborted"; header: string[]; category: string }
  | { kind: "planned"; header: string[]; plan: ParticipationProvisioningPlan; written: boolean };

export async function runParticipationProvisioning(input: ParticipationRunnerInput): Promise<ParticipationRunnerOutput> {
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
  const fixtures = input.fixtures ?? DEMO_PARTICIPATIONS;

  const problems = validateDemoParticipations(fixtures);
  if (problems.length > 0) return abort([], "fixtures-invalid");
  if (!runLocalCryptoPreflight(input.crypto)) return abort([], "crypto-failed");

  const header = [
    `Project: ${config.projectId} (verified against FIREBASE_PROJECT_ID)`,
    `Team: ${config.teamId}`,
    `Participation fixtures: ${fixtures.length} (fixtures valid)`,
  ];

  if (config.mode === "offline-dry-run") {
    return {
      exitCode: 0,
      stdout: [...header, "Mode: offline (no network, no reads, no writes). Run with the live flags for a read-only preflight."],
      stderr: [],
    };
  }

  if (config.credentials === null) return abort([], "adapters-missing");
  let adapters: ParticipationOnlineAdapters;
  try {
    adapters = await input.createOnlineAdapters({ projectId: config.projectId, credentials: config.credentials });
  } catch {
    return abort([], "adapters-failed");
  }

  const writesRequested = config.mode === "write" && config.writesAllowed;
  const createKey = input.createKey ?? generateMemberRef;
  const crypto = input.crypto;

  let result: TransactionResult;
  try {
    result = await adapters.runTransaction(async (tx: ParticipationTx): Promise<TransactionResult> => {
      const team = await tx.get(`teams/${config.teamId}`);
      const presenterMembership = await tx.get(`teamMemberships/${membershipDocId(config.presenterUid, config.teamId)}`);
      const verified = verifyTargetTeam({
        teamId: config.teamId,
        presenterUid: config.presenterUid,
        teamExists: team.exists,
        presenterMembershipRaw: presenterMembership.exists ? presenterMembership.data : undefined,
      });
      if (!verified.ok) return { kind: "aborted", header, category: verified.reason };

      const members = new Map<string, ObservedMember>();
      const erasing = new Set<string>();
      for (const identity of DEMO_MEMBER_IDENTITIES) {
        const membership = await tx.get(`teamMemberships/${membershipDocId(identity.uid, config.teamId)}`);
        members.set(identity.uid, { membership: membership.exists ? membership.data : undefined });
        const erasure = await tx.get(`accountErasures/${identity.uid}`);
        if (erasure.exists) erasing.add(identity.uid);
      }
      const teamMemberships = await tx.queryTeamMemberships(config.teamId);

      const projectIds = [...new Set(fixtures.map((f) => f.projectId))];
      const projects = new Map<string, ObservedProject>();
      for (const projectId of projectIds) {
        const doc = await tx.get(`teamProjects/${projectId}`);
        if (!doc.exists) {
          projects.set(projectId, { project: undefined });
          continue;
        }
        const opened = openTeamProjectDocument(projectId, doc.data as Record<string, unknown>, crypto.openRecord);
        const parsed = opened === null ? null : parseStoredTeamProject(opened, projectId, config.teamId);
        projects.set(projectId, {
          project: parsed === null ? null : { teamId: parsed.teamId, archived: parsed.archived, startDate: parsed.startDate, endDate: parsed.endDate },
        });
      }

      const participations = new Map<string, ParticipationObservation>();
      for (const fixture of fixtures) {
        const doc = await tx.get(`teamProjectParticipations/${fixture.participationId}`);
        participations.set(fixture.participationId, { raw: doc.exists ? doc.data : undefined });
      }

      const plan = planParticipationProvisioning({
        teamId: config.teamId,
        members,
        teamMemberships,
        erasing,
        projects,
        participations,
        fixtures,
        createKey,
      });
      if (!plan.noConflicts) return { kind: "planned", header, plan, written: false };
      if (!writesRequested) return { kind: "planned", header, plan, written: false };

      // Writes are queued and applied only after every read above. The memberRef update is field-level; the participation
      // create is create-only, so a document that appeared meanwhile fails the whole transaction instead of being overwritten.
      for (const member of plan.members) {
        if (member.action === "materialize" && member.memberRef !== null) {
          tx.updateMembershipMemberRef(`teamMemberships/${membershipDocId(member.uid, config.teamId)}`, member.memberRef);
        }
      }
      for (const item of plan.participations) {
        if (item.action === "create" && item.fields !== undefined) {
          tx.create(`teamProjectParticipations/${item.participationId}`, participationDocumentFor(item.participationId, item.fields));
        }
      }
      return { kind: "planned", header, plan, written: true };
    });
  } catch {
    return abort(header, "transaction-failed");
  }

  if (result.kind === "aborted") return abort(result.header, result.category);
  const { plan } = result;
  const lines = [...result.header, ...formatPlan(plan)];
  if (!plan.noConflicts) return abort([...lines, ...conflictLines(plan)], "conflicts-found");
  if (!writesRequested) {
    const gated = config.mode === "write" && !config.writesAllowed;
    if (gated) return abort(lines, "write-gate-not-satisfied");
    return { exitCode: 0, stdout: [...lines, "Dry run: nothing written."], stderr: [] };
  }
  const toMaterialize = plan.members.filter((m) => m.action === "materialize").length;
  const toCreate = plan.participations.filter((p) => p.action === "create").length;
  if (toMaterialize === 0 && toCreate === 0) {
    return { exitCode: 0, stdout: [...lines, "Write: nothing to write; every memberRef and participation already matches."], stderr: [] };
  }
  return {
    exitCode: 0,
    stdout: [
      ...lines,
      `Write: set memberRef on ${toMaterialize} memberships (field-level); created ${toCreate} participations. One transaction. Deletes: 0. Other membership fields: unchanged.`,
    ],
    stderr: [],
  };
}

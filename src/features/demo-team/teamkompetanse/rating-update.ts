import { createHash } from "node:crypto";
import { isValidTeamSkillAssessment, type TeamSkillAssessmentRecord } from "../../team-owned-skills/domain/team-skill-assessment";
import { openAssessmentDocument } from "../../team-owned-skills/server/assessment-level-codec";
import { SIMULATED_CONTRIBUTION_TEAM_ID } from "../../team-skills/domain/skill-contribution";
import {
  TEAMKOMPETANSE_AS_OF,
  TEAMKOMPETANSE_CRITERIA_VERSION,
  TEAMKOMPETANSE_RATING_UPDATE_AS_OF,
  type FixtureLevel,
} from "./fixtures";
import {
  mapTimestamps,
  resolveLiveCatalog,
  runTeamkompetanseSeed,
  type SeedDatabase,
  type SeedRef,
  type SeedSnapshot,
} from "./live";
import { buildTeamkompetansePlan, type PlannedAssessment } from "./plan";

/**
 * One approved change to an existing synthetic rating of the 2026-11-16 distribution update. Each change names the fictional
 * member and the fixture skill, and states the exact old and new level. Nothing else about an assessment changes.
 */
export interface RatingChange {
  readonly uid: string;
  readonly fixtureSkillId: string;
  readonly from: FixtureLevel;
  readonly to: FixtureLevel;
}

/** The 20 approved level changes. All 109 ratings, and every contributor count, stay as they are. */
export const RATING_CHANGES: readonly RatingChange[] = Object.freeze([
  { uid: "demo-member-03", fixtureSkillId: "skCiCd", from: 2, to: 3 },
  { uid: "demo-member-08", fixtureSkillId: "skCiCd", from: 3, to: 4 },
  { uid: "demo-member-01", fixtureSkillId: "skTestautomatisering", from: 3, to: 4 },
  { uid: "demo-member-07", fixtureSkillId: "skTestautomatisering", from: 2, to: 3 },
  { uid: "demo-member-06", fixtureSkillId: "skSystemarkitektur", from: 3, to: 4 },
  { uid: "demo-member-03", fixtureSkillId: "skDatamodellering", from: 2, to: 3 },
  { uid: "demo-member-06", fixtureSkillId: "skDatamodellering", from: 2, to: 3 },
  { uid: "demo-member-09", fixtureSkillId: "skDatamodellering", from: 3, to: 4 },
  { uid: "demo-member-01", fixtureSkillId: "skApiDesign", from: 2, to: 3 },
  { uid: "demo-member-03", fixtureSkillId: "skApiDesign", from: 3, to: 4 },
  { uid: "demo-member-06", fixtureSkillId: "skApiDesign", from: 2, to: 3 },
  { uid: "demo-member-09", fixtureSkillId: "skSkyplattform", from: 3, to: 2 },
  { uid: "demo-member-08", fixtureSkillId: "skHendelseshandtering", from: 3, to: 2 },
  { uid: "demo-member-04", fixtureSkillId: "skKunnskapsdeling", from: 3, to: 2 },
  { uid: "demo-member-10", fixtureSkillId: "skKunnskapsdeling", from: 3, to: 2 },
  { uid: "demo-member-02", fixtureSkillId: "skUtviklingsverktoy", from: 3, to: 2 },
  { uid: "demo-member-05", fixtureSkillId: "skTekniskDok", from: 3, to: 2 },
  { uid: "demo-member-05", fixtureSkillId: "skObservability", from: 4, to: 3 },
  { uid: "demo-member-07", fixtureSkillId: "skObservability", from: 3, to: 2 },
  { uid: "demo-member-05", fixtureSkillId: "skInfraKode", from: 4, to: 3 },
]);

/**
 * `identical`: the stored level already equals the target. `update`: the stored level is the approved old value and the
 * change is listed. `conflict`: anything else, including a missing document or an unexpected level. `unreadable`: present
 * but not a valid synthetic assessment.
 */
export type RatingUpdateState = "identical" | "update" | "conflict" | "unreadable";

export interface RatingUpdateCounts {
  identical: number;
  update: number;
  conflict: number;
  unreadable: number;
}

/**
 * Deterministic digest of the exact approved batch: the project, the team, and each approved (uid, fixture skill, from, to) in
 * list order. It holds no ratings beyond the approved list, no sealed envelopes and no secrets. The operator quotes it to
 * approve one batch; a write with a different digest is refused before any read.
 */
export function ratingUpdatePlanDigest(input: { requiredProjectId: string; teamId: string }): string {
  const body = JSON.stringify({
    project: input.requiredProjectId,
    team: input.teamId,
    changes: RATING_CHANGES.map((change) => [change.uid, change.fixtureSkillId, change.from, change.to]),
  });
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export interface RatingUpdateReport {
  mode: "preflight" | "write";
  projectId: string;
  teamId: string;
  planDigest: string;
  /** Category strings only. Never raw data, SDK text or identifiers beyond the fixed fictional uids. */
  blockers: string[];
  assessments: RatingUpdateCounts;
  /** Planned updates, in the approved list order, each with the states the transaction saw. */
  expectedUpdates: number;
  written: number | null;
  verified: RatingUpdateCounts | null;
  ok: boolean;
}

function changeKey(uid: string, skillId: string): string {
  return `${uid}\u0000${skillId}`;
}

/** The approved change for a planned assessment, keyed by the live skill id it resolves to. */
function changeIndex(liveSkillIdFor: ReadonlyMap<string, string>): Map<string, RatingChange> {
  const index = new Map<string, RatingChange>();
  for (const change of RATING_CHANGES) {
    const liveId = liveSkillIdFor.get(change.fixtureSkillId);
    if (liveId === undefined) throw new Error("rating-update: approved change has no resolved live skill");
    index.set(changeKey(change.uid, liveId), change);
  }
  return index;
}

/**
 * Classifies one stored assessment against its plan. Ownership, criteria version and creation time must match the approved
 * synthetic dataset before a level is considered. An update is accepted only for a listed change whose old level is stored.
 */
export function classifyRatingUpdate(
  planned: PlannedAssessment,
  change: RatingChange | undefined,
  teamId: string,
  snapshot: SeedSnapshot,
): RatingUpdateState {
  if (!snapshot.exists) return "conflict";
  const opened = openAssessmentDocument(planned.uid, teamId, planned.skillId, mapTimestamps(snapshot.data()));
  if (!isValidTeamSkillAssessment(opened, { uid: planned.uid, skillId: planned.skillId })) return "unreadable";
  const record = opened as TeamSkillAssessmentRecord;
  if (record.teamId !== teamId || record.criteriaVersion !== TEAMKOMPETANSE_CRITERIA_VERSION) return "conflict";
  if (record.createdAt.getTime() !== TEAMKOMPETANSE_AS_OF.getTime()) return "conflict";
  if (record.level === planned.level) return "identical";
  if (change !== undefined && change.to === planned.level && record.level === change.from) return "update";
  return "conflict";
}

function countStates(states: readonly RatingUpdateState[]): RatingUpdateCounts {
  const counts: RatingUpdateCounts = { identical: 0, update: 0, conflict: 0, unreadable: 0 };
  for (const state of states) counts[state] += 1;
  return counts;
}

/**
 * A run may proceed only when every planned record is either already at its target (`identical`) or an approved update
 * (`update`), with nothing conflicting or unreadable. An already-applied state is therefore a successful zero-write run.
 */
function allowsWrite(counts: RatingUpdateCounts): boolean {
  return counts.conflict === 0 && counts.unreadable === 0 && counts.identical + counts.update === 109;
}

/**
 * Preflight (read-only) or write for the approved rating update. It never creates or deletes a document and never touches
 * memberships, consent or Auth. A write runs one transaction that re-classifies every planned assessment, and updates only
 * the `level` envelope and `updatedAt` of the listed records that still hold their old value.
 */
export async function runRatingUpdate(input: {
  mode: "preflight" | "write";
  requiredProjectId: string;
  projectId: string;
  teamId: string;
  /** Required for `write`: must equal `ratingUpdatePlanDigest` for the same project and team. Checked before any read. */
  confirmDigest?: string;
  db: SeedDatabase;
  auth: { getUser(uid: string): Promise<{ uid: string; disabled: boolean }> };
}): Promise<RatingUpdateReport> {
  const planDigest = ratingUpdatePlanDigest({ requiredProjectId: input.requiredProjectId, teamId: input.teamId });
  const base = { mode: input.mode, projectId: input.projectId, teamId: input.teamId, planDigest };
  const empty = (blockers: string[]): RatingUpdateReport => ({
    ...base,
    blockers,
    assessments: { identical: 0, update: 0, conflict: 0, unreadable: 0 },
    expectedUpdates: RATING_CHANGES.length,
    written: null,
    verified: null,
    ok: false,
  });
  if (input.projectId !== input.requiredProjectId) return empty(["project-mismatch"]);
  if (input.teamId !== SIMULATED_CONTRIBUTION_TEAM_ID) return empty(["team-mismatch"]);
  // Approval covers one reviewed batch. A write without the digest of that exact batch stops here, before any read or write.
  if (input.mode === "write" && input.confirmDigest === undefined) return empty(["confirmation-required"]);
  if (input.mode === "write" && input.confirmDigest !== planDigest) return empty(["confirmation-mismatch"]);

  const catalog = await resolveLiveCatalog({ db: input.db, teamId: input.teamId });
  if (catalog.blockers.length > 0) return empty(catalog.blockers);

  // The team, Auth accounts, memberships and catalog are checked by the existing read-only preflight. Its assessment
  // classification is ignored here: it compares against the new plan, which is exactly what this operation changes.
  const seedPreflight = await runTeamkompetanseSeed({
    mode: "preflight",
    requiredProjectId: input.requiredProjectId,
    projectId: input.projectId,
    teamId: input.teamId,
    db: input.db,
    auth: input.auth,
  });
  const structuralBlockers = seedPreflight.blockers.filter((blocker) => blocker !== "assessment-conflict-or-unreadable");
  if (structuralBlockers.length > 0) return empty(structuralBlockers);
  if (seedPreflight.consent.identical !== 10 || seedPreflight.consent.conflict !== 0 || seedPreflight.consent.unreadable !== 0) {
    return empty(["consent-not-identical"]);
  }

  const plan = buildTeamkompetansePlan({ teamId: input.teamId, liveSkillIdFor: catalog.liveSkillIdFor });
  const changes = changeIndex(catalog.liveSkillIdFor);
  const refFor = (path: string): SeedRef => input.db.doc(path);
  const classifyAll = async (read: (ref: SeedRef) => Promise<SeedSnapshot>) => {
    const states: RatingUpdateState[] = [];
    for (const planned of plan.assessments) {
      const change = changes.get(changeKey(planned.uid, planned.skillId));
      states.push(classifyRatingUpdate(planned, change, input.teamId, await read(refFor(`teamSkillAssessments/${planned.docId}`))));
    }
    return states;
  };

  const preview = await classifyAll((ref) => input.db.get(ref));
  const counts = countStates(preview);
  const report = { ...base, assessments: counts, expectedUpdates: RATING_CHANGES.length };
  if (!allowsWrite(counts)) {
    return { ...report, blockers: ["assessment-gate-failed"], written: null, verified: null, ok: false };
  }
  if (input.mode === "preflight") return { ...report, blockers: [], written: null, verified: null, ok: true };

  const written = await input.db.runTransaction(async (tx) => {
    const inside = await classifyAll((ref) => tx.get(ref));
    if (!allowsWrite(countStates(inside))) return { blocked: true, count: 0 };
    let count = 0;
    for (const [index, planned] of plan.assessments.entries()) {
      if (inside[index] !== "update") continue;
      // Only the sealed level and updatedAt change. uid, teamId, skillId, criteriaVersion and createdAt stay as they are.
      tx.update(refFor(`teamSkillAssessments/${planned.docId}`), {
        level: planned.data.level,
        updatedAt: TEAMKOMPETANSE_RATING_UPDATE_AS_OF,
      });
      count += 1;
    }
    return { blocked: false, count };
  });
  if (written.blocked) return { ...report, blockers: ["assessment-gate-failed"], written: 0, verified: null, ok: false };

  const after = countStates(await classifyAll((ref) => input.db.get(ref)));
  return {
    ...report,
    assessments: after,
    blockers: allowsWrite(after) ? [] : ["post-write-verification-failed"],
    written: written.count,
    verified: after,
    ok: after.identical === 109 && after.update === 0 && after.conflict === 0 && after.unreadable === 0,
  };
}

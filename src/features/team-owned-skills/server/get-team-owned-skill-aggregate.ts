import "server-only";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { verifyIdToken, type VerifiedIdentity, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { sortSkillRows } from "../../skill-profiles/domain/skill-profile-view";
import { isEffectiveSkillContribution } from "../../team-skills/domain/skill-contribution";
import { SKILL_COVERAGE_MIN_CONTRIBUTORS, TEAM_SKILL_COHORT_SCAN_MAX } from "../../team-skills/domain/skill-coverage-policy";
import { deriveTeamLevel } from "../../team-skills/domain/team-level";
import { getDefaultSkillContributionStore, type SkillContributionStore } from "../../team-skills/server/skill-contribution-store";
import { requireGenuineMemberWith, type GenuineMembershipReads } from "../../teams/domain/genuine-membership";
import { membershipDocId } from "../../teams/domain/team-membership";
import { isValidTeamSkillRecord, TEAM_SKILLS_PER_TEAM_MAX, type TeamSkillRecord } from "../domain/team-skill";
import { readTeamSkillRatingsBatch, type ReadTeamSkillRatingsBatchResult, type TeamSkillRatingTarget } from "./read-team-skill-ratings-batch";
import { getDefaultTeamSkillStore, type TeamSkillStore, type TeamSkillTx } from "./team-skill-store";

/**
 * Read budget of one aggregate: eligible people × active skills. Over this the aggregate is `incomplete` and nothing
 * is derived. The bound is a cost limit, not a privacy threshold.
 */
export const TEAM_OWNED_AGGREGATE_MAX_READS = 20000;

/**
 * One team-owned skill's team-level status. `value` carries only the derived integer level. No count, uid, per-person
 * value, contributor number or criteria-version breakdown is returned.
 */
export type TeamOwnedSkillAggregateRow =
  | { skillId: string; name: string; state: "value"; level: 1 | 2 | 3 | 4 }
  | { skillId: string; name: string; state: "insufficient_data" };

export type TeamOwnedSkillAggregateResponse =
  | { availability: "available"; rows: TeamOwnedSkillAggregateRow[] }
  /** The scan or read budget was exceeded: nothing is derived from a known-incomplete cohort. */
  | { availability: "incomplete"; rows: [] };

export type GetTeamOwnedSkillAggregateError = AuthRefusal | "forbidden" | "team_disabled" | "read_failed";

export type GetTeamOwnedSkillAggregateResult =
  | ({ ok: true } & TeamOwnedSkillAggregateResponse)
  | { ok: false; error: GetTeamOwnedSkillAggregateError };

export interface GetTeamOwnedSkillAggregateDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  /** Team-skill store; supplies the active skill definitions only. */
  skillStore?: TeamSkillStore;
  /** The existing C2 membership scan. This module is its one approved team-owned consumer (see SPEC §6). */
  contributionStore?: SkillContributionStore;
  readRatings?: (
    uids: readonly string[],
    teamId: string,
    targets: readonly TeamSkillRatingTarget[],
  ) => Promise<ReadTeamSkillRatingsBatchResult>;
}

/** Same gate as the team-skill read: genuine member of an active team, read in one transaction with the skill list. */
async function gateAndLoadActiveSkills(
  store: TeamSkillStore,
  identity: VerifiedIdentity,
  teamId: string,
): Promise<{ ok: true; skills: Array<{ skillId: string; record: TeamSkillRecord }> } | { ok: false; error: GetTeamOwnedSkillAggregateError }> {
  return store.runTransaction(async (tx: TeamSkillTx) => {
    const reads: GenuineMembershipReads = {
      getTeamStatus: (id) => tx.getTeamStatus(id),
      getMembership: (uid, id) => tx.getMembership(uid, id),
    };
    const member = await requireGenuineMemberWith(identity, teamId, reads);
    if (!member.ok) return { ok: false as const, error: member.error };

    const raw = await tx.listSkills(teamId, TEAM_SKILLS_PER_TEAM_MAX + 1);
    if (raw.length > TEAM_SKILLS_PER_TEAM_MAX) return { ok: false as const, error: "read_failed" as const };
    const skills: Array<{ skillId: string; record: TeamSkillRecord }> = [];
    for (const { id, data } of raw) {
      if (!isValidTeamSkillRecord(data, { teamId, skillId: id })) return { ok: false as const, error: "read_failed" as const };
      if (data.active) skills.push({ skillId: id, record: data });
    }
    return { ok: true as const, skills };
  });
}

/**
 * Uids of members of this team who have an effective contribution (opt-in at the current notice version). Each document
 * must match its own id and the team; anything else is ignored. Duplicates collapse. Internal: never returned.
 */
function optedInUids(docs: ReadonlyArray<{ id: string; data: unknown }>, teamId: string): string[] {
  const uids = new Set<string>();
  for (const { id, data } of docs) {
    if (typeof data !== "object" || data === null) continue;
    const { uid, teamId: storedTeamId } = data as Record<string, unknown>;
    if (typeof uid !== "string" || uid.length === 0 || storedTeamId !== teamId) continue;
    if (id !== membershipDocId(uid, teamId)) continue;
    if (!isEffectiveSkillContribution(data)) continue;
    uids.add(uid);
  }
  return [...uids];
}

/**
 * Team-level status of each **active** team-owned skill (SPEC §6). Order: verified token → genuine member of an active
 * team → active skills (none ⇒ empty, no scan) → bounded membership scan (over the bound ⇒ `incomplete`) → opted-in
 * uids → exact per-person rating reads for those uids and skills → per skill: suppressed when any rating is suspect,
 * otherwise `deriveTeamLevel` at `SKILL_COVERAGE_MIN_CONTRIBUTORS`. Read-only, uncached. Any failed read is
 * `read_failed`, never a partial result.
 */
export function createGetTeamOwnedSkillAggregate(deps: GetTeamOwnedSkillAggregateDeps = {}) {
  return async function getTeamOwnedSkillAggregate(idToken: string, teamId: string): Promise<GetTeamOwnedSkillAggregateResult> {
    const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
    if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };

    try {
      const gated = await gateAndLoadActiveSkills(deps.skillStore ?? getDefaultTeamSkillStore(), verified.identity, teamId);
      if (!gated.ok) return gated;
      const { skills } = gated;
      if (skills.length === 0) return { ok: true, availability: "available", rows: [] };

      const scanned = await (deps.contributionStore ?? getDefaultSkillContributionStore()).listMembershipsForCoverage(
        teamId,
        TEAM_SKILL_COHORT_SCAN_MAX + 1,
      );
      if (scanned.length > TEAM_SKILL_COHORT_SCAN_MAX) return { ok: true, availability: "incomplete", rows: [] };
      const uids = optedInUids(scanned, teamId);

      if (uids.length * skills.length > TEAM_OWNED_AGGREGATE_MAX_READS) return { ok: true, availability: "incomplete", rows: [] };

      const targets: TeamSkillRatingTarget[] = skills.map(({ skillId, record }) => ({
        skillId,
        criteriaVersion: record.criteriaVersion,
      }));
      const readRatings = deps.readRatings ?? ((u, t, g) => readTeamSkillRatingsBatch(u, t, g));
      const ratings: ReadTeamSkillRatingsBatchResult =
        uids.length === 0 ? { ok: true, bySkill: new Map() } : await readRatings(uids, teamId, targets);
      if (!ratings.ok) return { ok: false, error: "read_failed" };

      const rows: TeamOwnedSkillAggregateRow[] = skills.map(({ skillId, record }): TeamOwnedSkillAggregateRow => {
        const tally = ratings.bySkill.get(skillId);
        const levels = tally?.levels ?? [];
        if (tally?.suspect || levels.length < SKILL_COVERAGE_MIN_CONTRIBUTORS) {
          return { skillId, name: record.name, state: "insufficient_data" };
        }
        const derived = deriveTeamLevel(levels, SKILL_COVERAGE_MIN_CONTRIBUTORS);
        if (derived.state === "insufficient_data") return { skillId, name: record.name, state: "insufficient_data" };
        return { skillId, name: record.name, state: "value", level: derived.level };
      });

      return { ok: true, availability: "available", rows: sortRows(rows, skills) };
    } catch {
      return { ok: false, error: "read_failed" };
    }
  };
}

/** Display order of the team's skills: the same `sortOrder`, then id, as the team list. */
function sortRows(
  rows: TeamOwnedSkillAggregateRow[],
  skills: ReadonlyArray<{ skillId: string; record: TeamSkillRecord }>,
): TeamOwnedSkillAggregateRow[] {
  const order = new Map(sortSkillRows(skills.map(({ skillId, record }) => ({ treeId: skillId, name: record.name }))).map((row, index) => [row.treeId, index]));
  return [...rows].sort((a, b) => (order.get(a.skillId) ?? 0) - (order.get(b.skillId) ?? 0));
}

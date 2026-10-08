import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { sortSkillRows } from "../../skill-profiles/domain/skill-profile-view";
import { readSkillLevelsBatch } from "../../skill-profiles/server/read-skill-levels-batch";
import { membershipDocId } from "../../teams/domain/team-membership";
import { isEffectiveSkillContribution } from "../domain/skill-contribution";
import { deriveCoverageState, type CoverageRowState } from "../domain/skill-coverage";
import { TEAM_SKILL_COHORT_SCAN_MAX } from "../domain/skill-coverage-policy";
import type { RequiredLevel } from "../domain/skill-need";
import { requireGenuineMember, type GenuineMembershipDeps } from "./genuine-team-membership";
import {
  getDefaultSkillNeedCatalogReader,
  readValidSkillTree,
  type SkillNeedCatalogReader,
} from "./skill-need-catalog";
import { getDefaultSkillNeedsStore, type SkillNeedsStore } from "./skill-needs-store";
import { getDefaultSkillContributionStore, type SkillContributionStore } from "./skill-contribution-store";

/**
 * The complete per-need row (SPEC BR-22), built field by field. `state` is the
 * only varying field and is categorical; there is no count, level, identity or
 * contributor-dependent field. `areaName` is `null` only for `area_unavailable`.
 */
export interface SkillCoverageRow {
  treeId: string;
  areaName: string | null;
  requiredLevel: RequiredLevel;
  requiredCoverage: number;
  state: CoverageRowState;
}

export type SkillCoverageResponse =
  | { availability: "available"; rows: SkillCoverageRow[] }
  /** The membership scan hit its bound: nothing is derived from a known-incomplete cohort. */
  | { availability: "incomplete"; rows: [] };

export type GetTeamSkillCoverageError = "unauthenticated" | "forbidden" | "team_disabled" | "read_failed";

export type GetTeamSkillCoverageResult =
  | ({ ok: true } & SkillCoverageResponse)
  | { ok: false; error: GetTeamSkillCoverageError };

/**
 * Identity-stripped level reader (same contract as `readSkillLevelsBatch`):
 * per requested tree, the valid personal levels only. Injected so this module
 * never consumes raw profiles; the production binding is `readSkillLevelsBatch`.
 */
export type ReadSkillLevels = (
  uids: readonly string[],
  treeIds: readonly string[],
) => Promise<{ ok: true; levelsByTree: ReadonlyMap<string, readonly number[]> } | { ok: false }>;

export interface GetTeamSkillCoverageDeps {
  readLevels: ReadSkillLevels;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  /** Seam for the genuine-membership reads. */
  reads?: GenuineMembershipDeps["reads"];
  needsStore?: SkillNeedsStore;
  catalogReader?: SkillNeedCatalogReader;
  contributionStore?: SkillContributionStore;
}

/**
 * Uids of genuine memberships of this team with effective participation. A
 * document counts only when its stored identity matches its id and the team
 * (never trusting a team-scoped query alone); duplicates collapse. Internal:
 * the set never reaches a response or a log.
 */
function eligibleUids(docs: ReadonlyArray<{ id: string; data: unknown }>, teamId: string): string[] {
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

/** Named areas by name, then unavailable areas by tree id; deterministic regardless of read order. */
function sortRows(rows: SkillCoverageRow[]): SkillCoverageRow[] {
  const byId = new Map(rows.map((row) => [row.treeId, row]));
  const named = sortSkillRows(
    rows.filter((row) => row.areaName !== null).map((row) => ({ treeId: row.treeId, name: row.areaName ?? "" })),
  );
  const unavailable = rows.filter((row) => row.areaName === null).sort((a, b) => (a.treeId < b.treeId ? -1 : a.treeId > b.treeId ? 1 : 0));
  return [...named.flatMap(({ treeId }) => byId.get(treeId) ?? []), ...unavailable];
}

/**
 * Privacy-thresholded team coverage (SPEC BR-6, BR-12–BR-20). Order: verified
 * token → genuine member of an active team (app-admin status never consulted)
 * → needs (none ⇒ empty, no profile read) → bounded membership scan (over the
 * bound ⇒ `incomplete`, nothing derived) → eligible uids → direct tree reads
 * (invalid ⇒ `area_unavailable`, from integrity only) → one `readLevels` call
 * for exactly those uids and valid trees → per-need categorical state.
 * Read-only and uncached. Any failed read is `read_failed`, never a partial or
 * `insufficient_data` response.
 */
export function createGetTeamSkillCoverage(deps: GetTeamSkillCoverageDeps) {
  return async function getTeamSkillCoverage(idToken: string, teamId: string): Promise<GetTeamSkillCoverageResult> {
    const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
    if (!verified.ok) return { ok: false, error: "unauthenticated" };

    const member = await requireGenuineMember(verified.identity, teamId, { reads: deps.reads });
    if (!member.ok) return { ok: false, error: member.error };

    try {
      const { needs } = await (deps.needsStore ?? getDefaultSkillNeedsStore()).listNeeds(teamId);
      if (needs.length === 0) return { ok: true, availability: "available", rows: [] };

      const scanned = await (deps.contributionStore ?? getDefaultSkillContributionStore()).listMembershipsForCoverage(
        teamId,
        TEAM_SKILL_COHORT_SCAN_MAX + 1,
      );
      if (scanned.length > TEAM_SKILL_COHORT_SCAN_MAX) return { ok: true, availability: "incomplete", rows: [] };
      const uids = eligibleUids(scanned, teamId);

      const catalogReader = deps.catalogReader ?? getDefaultSkillNeedCatalogReader();
      const trees = await Promise.all(needs.map((need) => readValidSkillTree(catalogReader, need.treeId)));
      const validTreeIds = needs.filter((_, index) => trees[index] !== null).map((need) => need.treeId);

      let levelsByTree: ReadonlyMap<string, readonly number[]> = new Map();
      if (uids.length > 0 && validTreeIds.length > 0) {
        const levels = await deps.readLevels(uids, validTreeIds);
        if (!levels.ok) return { ok: false, error: "read_failed" };
        levelsByTree = levels.levelsByTree;
      }

      const rows = needs.map((need, index): SkillCoverageRow => {
        const tree = trees[index];
        const base = { treeId: need.treeId, requiredLevel: need.requiredLevel, requiredCoverage: need.requiredCoverage };
        if (tree === null) return { ...base, areaName: null, state: "area_unavailable" };
        const state = deriveCoverageState({ ...base, levels: levelsByTree.get(need.treeId) ?? [] });
        return { ...base, areaName: tree.name, state };
      });
      return { ok: true, availability: "available", rows: sortRows(rows) };
    } catch {
      return { ok: false, error: "read_failed" };
    }
  };
}

/** Production binding: the identity-stripped adapter is the only way personal levels reach C2. */
export const getTeamSkillCoverage = createGetTeamSkillCoverage({ readLevels: readSkillLevelsBatch });

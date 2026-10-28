import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { getOwnSkills, type GetOwnSkillsResult } from "../../skill-profiles/server/get-own-skills";
import { compareWithRole, type ComparisonRow } from "../domain/comparison";
import { readOwnTargetRole, type RoleTargetDeps } from "./get-own-role-target";
import { getDefaultSkillTreeReader } from "./skill-tree-seam";
import { resolveSkillTreeReferences, type RawSkillTreeReader } from "./skill-tree-seam-types";

export interface RoleComparisonDeps extends RoleTargetDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  treeReader?: RawSkillTreeReader;
  /** The owner's own C1 levels (existing owner-scoped read, `getOwnSkills`). Injected by tests. */
  readSkills?: (idToken: string) => Promise<GetOwnSkillsResult>;
}

export type RoleComparisonRow = ComparisonRow & { treeName: string | null };

export type RoleComparison =
  | { state: "no_target" }
  | { state: "target_unavailable"; reason: "no_expectations" | "unavailable" }
  | { state: "available"; target: { roleId: string; name: string }; rows: RoleComparisonRow[] };

export type GetOwnRoleComparisonResult =
  | { ok: true; comparison: RoleComparison }
  | { ok: false; error: "unauthenticated" | "persistence_failed" };

const UNAVAILABLE: RoleComparison = { state: "target_unavailable", reason: "unavailable" };

/**
 * Owner-only, derived and live comparison of the caller's target role with the caller's own C1 levels (BR-9 to BR-13,
 * PG-4). The subject is the verified token uid; the C1 read takes the same token. Nothing is written or cached. A
 * failed read is a neutral `persistence_failed`, never a status (BR-11). `area_unavailable` is per row, for one invalid
 * or missing SkillTree; a target with no valid SkillTree is `target_unavailable` with no rows.
 */
export async function getOwnRoleComparison(
  idToken: string,
  deps: RoleComparisonDeps = {},
): Promise<GetOwnRoleComparisonResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: "unauthenticated" };

  try {
    const target = await readOwnTargetRole(verified.identity.uid, deps);
    if (target.status === "none") return { ok: true, comparison: { state: "no_target" } };
    if (target.status === "unavailable") return { ok: true, comparison: UNAVAILABLE };

    const { roleId, role } = target;
    if (role.archivedAt !== undefined) return { ok: true, comparison: UNAVAILABLE };
    if (role.expectations.length === 0) {
      return { ok: true, comparison: { state: "target_unavailable", reason: "no_expectations" } };
    }

    const treeIds = role.expectations.map((expectation) => expectation.treeId);
    const references = await resolveSkillTreeReferences(treeIds, deps.treeReader ?? getDefaultSkillTreeReader());
    const unavailableTreeIds = new Set(treeIds.filter((treeId) => references.get(treeId)?.status !== "valid"));
    if (role.expectations.every((expectation) => unavailableTreeIds.has(expectation.treeId))) {
      return { ok: true, comparison: UNAVAILABLE };
    }

    const skills = await (deps.readSkills ?? ((token: string) => getOwnSkills(token)))(idToken);
    if (!skills.ok) {
      return skills.error === "unauthenticated"
        ? { ok: false, error: "unauthenticated" }
        : { ok: false, error: "persistence_failed" };
    }

    const listedTreeIds = new Set(skills.dto.skills.map((skill) => skill.treeId));
    // A truncated C1 catalog that omits a comparable tree cannot prove "no level"; it is a failure, not `not_assessed`.
    if (skills.dto.truncated && treeIds.some((treeId) => !listedTreeIds.has(treeId) && !unavailableTreeIds.has(treeId))) {
      return { ok: false, error: "persistence_failed" };
    }

    const ownLevels = new Map<string, number>();
    for (const skill of skills.dto.skills) {
      if (skill.level !== null) ownLevels.set(skill.treeId, skill.level);
    }

    const rows = compareWithRole({ expectations: role.expectations, ownLevels, unavailableTreeIds });
    return {
      ok: true,
      comparison: {
        state: "available",
        target: { roleId, name: role.name },
        rows: rows.map((row) => {
          const reference = references.get(row.treeId);
          return { ...row, treeName: reference?.status === "valid" ? reference.name : null };
        }),
      },
    };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

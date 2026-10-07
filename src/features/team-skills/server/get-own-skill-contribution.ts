import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isEffectiveSkillContribution } from "../domain/skill-contribution";
import { resolveGenuineTeamMembership } from "./genuine-team-membership";
import { getDefaultSkillContributionStore, type SkillContributionStore } from "./skill-contribution-store";

export type GetOwnSkillContributionError = "unauthenticated" | "forbidden" | "persistence_failed";

export type GetOwnSkillContributionResult =
  | { ok: true; contributing: boolean; canOptIn: boolean }
  | { ok: false; error: GetOwnSkillContributionError };

export interface GetOwnSkillContributionDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: SkillContributionStore;
}

/**
 * The caller's own participation state (SPEC BR-9). Subject is the verified
 * token's uid only. A non-member (app admins included) is `forbidden`.
 * `contributing` follows the domain's effective-consent rule (current notice
 * version); `canOptIn` is genuine member and active team. Writes nothing.
 */
export async function getOwnSkillContribution(
  idToken: string,
  teamId: string,
  deps: GetOwnSkillContributionDeps = {},
): Promise<GetOwnSkillContributionResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: "unauthenticated" };
  const identity = verified.identity;
  const store = deps.store ?? getDefaultSkillContributionStore();

  try {
    return await store.runTransaction(async (tx): Promise<GetOwnSkillContributionResult> => {
      const genuine = await resolveGenuineTeamMembership(identity, teamId, { reads: tx.reads });
      if (!genuine.ok) return { ok: false, error: "persistence_failed" };
      if (genuine.relationship === "denied") return { ok: false, error: "forbidden" };
      const membership = await tx.reads.getMembership(identity.uid, teamId);
      return {
        ok: true,
        contributing: isEffectiveSkillContribution(membership),
        canOptIn: genuine.teamStatus === "active",
      };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { SKILL_CONTRIBUTION_FIELD } from "../domain/skill-contribution";
import { resolveGenuineTeamMembership } from "./genuine-team-membership";
import { getDefaultSkillContributionStore, type SkillContributionStore } from "./skill-contribution-store";

export type WithdrawOwnSkillContributionError = "unauthenticated" | "forbidden" | "persistence_failed";

export type WithdrawOwnSkillContributionResult =
  | { ok: true; contributing: false }
  | { ok: false; error: WithdrawOwnSkillContributionError };

export interface WithdrawOwnSkillContributionDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: SkillContributionStore;
}

/**
 * Withdraw the caller's participation (SPEC BR-9). Requires only the genuine
 * membership: any team status, so a member of a disabled team can still
 * withdraw. Deletes the field physically (stale or malformed objects included);
 * idempotent: an absent field succeeds without any write. No body is read.
 */
export async function withdrawOwnSkillContribution(
  idToken: string,
  teamId: string,
  deps: WithdrawOwnSkillContributionDeps = {},
): Promise<WithdrawOwnSkillContributionResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: "unauthenticated" };
  const identity = verified.identity;
  const store = deps.store ?? getDefaultSkillContributionStore();

  try {
    return await store.runTransaction(async (tx): Promise<WithdrawOwnSkillContributionResult> => {
      const genuine = await resolveGenuineTeamMembership(identity, teamId, { reads: tx.reads });
      if (!genuine.ok) return { ok: false, error: "persistence_failed" };
      if (genuine.relationship === "denied") return { ok: false, error: "forbidden" };

      const membership = await tx.reads.getMembership(identity.uid, teamId);
      if (typeof membership === "object" && membership !== null && Object.hasOwn(membership, SKILL_CONTRIBUTION_FIELD)) {
        tx.deleteField(identity.uid, teamId);
      }
      return { ok: true, contributing: false };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { SKILL_CONTRIBUTION_NOTICE_VERSION } from "../domain/skill-coverage-policy";
import { requireGenuineMember } from "./genuine-team-membership";
import { getDefaultSkillContributionStore, type SkillContributionStore } from "./skill-contribution-store";

export type SetOwnSkillContributionError =
  | "unauthenticated"
  | "forbidden"
  | "team_disabled"
  | "invalid_input"
  | "notice_outdated"
  | "persistence_failed";

export type SetOwnSkillContributionResult =
  | { ok: true; contributing: true }
  | { ok: false; error: SetOwnSkillContributionError };

export interface SetOwnSkillContributionDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: SkillContributionStore;
  now?: () => Date;
}

/** Body must be exactly `{ noticeVersion: <integer> }`. */
function parseNoticeVersion(body: unknown): number | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "noticeVersion") return null;
  const { noticeVersion } = body as { noticeVersion: unknown };
  return typeof noticeVersion === "number" && Number.isInteger(noticeVersion) ? noticeVersion : null;
}

/**
 * Opt the caller in for one team (SPEC BR-9). Subject is the verified token's
 * uid; membership and team are re-read inside the transaction in BR-18 order
 * (membership, then active), and only then is the body judged. A version other
 * than the current one is `notice_outdated`. Writes exactly
 * `{ noticeVersion, consentedAt: now }` with `update` (re-opt-in overwrites, a
 * stale or malformed object is replaced); never creates a membership.
 */
export async function setOwnSkillContribution(
  idToken: string,
  teamId: string,
  body: unknown,
  deps: SetOwnSkillContributionDeps = {},
): Promise<SetOwnSkillContributionResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: "unauthenticated" };
  const identity = verified.identity;
  const store = deps.store ?? getDefaultSkillContributionStore();
  const now = (deps.now ?? (() => new Date()))();

  try {
    return await store.runTransaction(async (tx): Promise<SetOwnSkillContributionResult> => {
      const member = await requireGenuineMember(identity, teamId, { reads: tx.reads });
      if (!member.ok) return { ok: false, error: member.error === "read_failed" ? "persistence_failed" : member.error };

      const noticeVersion = parseNoticeVersion(body);
      if (noticeVersion === null) return { ok: false, error: "invalid_input" };
      if (noticeVersion !== SKILL_CONTRIBUTION_NOTICE_VERSION) return { ok: false, error: "notice_outdated" };

      tx.setField(identity.uid, teamId, { noticeVersion: SKILL_CONTRIBUTION_NOTICE_VERSION, consentedAt: now });
      return { ok: true, contributing: true };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

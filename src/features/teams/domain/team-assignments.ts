import "server-only";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { isAllowedTeamId, type TeamId } from "../../pulse-survey/domain/teams";

/**
 * Static, server-only, deploy-time mapping of Firebase-verified email
 * addresses to a `teamId`. Not user-selectable and not writable from any
 * application code path — edited only via a code change and redeploy,
 * analogous to `ALLOWED_TEAM_IDS`
 * (docs/features/results-dashboard/SPEC.md — "Team assignment").
 *
 * Values are intentionally untyped strings (not `TeamId`) so a `teamId`
 * that has since been removed from `ALLOWED_TEAM_IDS` is caught by the
 * runtime `isAllowedTeamId` check below rather than assumed valid.
 */
const TEAM_ASSIGNMENTS: Readonly<Record<string, string>> = {};

export type ResolveTeamResult =
  | { ok: true; teamId: TeamId }
  | { ok: false; reason: "unverified" | "unassigned" };

export interface ResolveTeamDeps {
  assignments?: Readonly<Record<string, string>>;
}

/**
 * Resolves a signed-in user's team solely from their Firebase-verified
 * identity against the static assignment mapping. Never accepts a
 * client-supplied `teamId` or email — `identity` must come from
 * `verifyIdToken` (`.claude/rules/security.md`).
 */
export function resolveTeamForUser(
  identity: VerifiedIdentity,
  deps: ResolveTeamDeps = {},
): ResolveTeamResult {
  if (!identity.emailVerified) {
    return { ok: false, reason: "unverified" };
  }

  const assignments = deps.assignments ?? TEAM_ASSIGNMENTS;
  const assignedTeamId = assignments[identity.email];

  if (!assignedTeamId || !isAllowedTeamId(assignedTeamId)) {
    return { ok: false, reason: "unassigned" };
  }

  return { ok: true, teamId: assignedTeamId };
}

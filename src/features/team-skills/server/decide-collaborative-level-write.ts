import "server-only";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import { parseCollaborativeLevelInput } from "../domain/collaborative-level-input";
import { requireTeamAdministrator, type GenuineMembershipDeps } from "./genuine-team-membership";
import type { RequireGenuineError } from "../../teams/domain/genuine-membership";

/**
 * Authorization and input decision for setting or clearing one collaborative team level (Felles mode). It performs NO
 * persistence: the write route is approval-gated and not built yet. Authorization runs before input validation, so a
 * caller without the role learns nothing from the payload. Only a genuine teamadmin or a superadmin of an active team
 * passes. It reads no personal data: no member profiles and no participation records.
 */
export type CollaborativeLevelWriteDecision =
  | { ok: true; teamId: string; treeId: string; level: SelfAssessedLevel | null }
  | { ok: false; error: "invalid_input" | RequireGenuineError };

export interface DecideCollaborativeLevelWriteInput {
  identity: VerifiedIdentity;
  teamId: string;
  treeId: string;
  value: unknown;
}

export async function decideCollaborativeLevelWrite(
  input: DecideCollaborativeLevelWriteInput,
  deps: GenuineMembershipDeps = {},
): Promise<CollaborativeLevelWriteDecision> {
  const authorized = await requireTeamAdministrator(input.identity, input.teamId, deps);
  if (!authorized.ok) return { ok: false, error: authorized.error };

  const parsed = parseCollaborativeLevelInput(input.value);
  if (!parsed.ok) return { ok: false, error: "invalid_input" };

  return { ok: true, teamId: input.teamId, treeId: input.treeId, level: parsed.level };
}

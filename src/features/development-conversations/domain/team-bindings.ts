import { isMemberRef } from "../../teams/domain/member-ref";
import { isPlainObject, hasExactKeys } from "./stored-shape";

/**
 * Per-team shared-access bindings of one participant invitation (A2.1 revision, the approved policy).
 *
 * At invitation time the server records every active team in which the owner and the colleague both hold a genuine
 * membership, together with both membership-instance references for that team. Access is then authorized while at least
 * one recorded team still satisfies the rule, so losing one shared team does not revoke access while another recorded
 * team remains valid. A recorded reference names one membership instance: a rejoin under a new `memberRef` does not match
 * and grants nothing. Teams that become shared later are never added to an existing binding.
 *
 * The map is server-managed. A client never supplies it, and no DTO carries it.
 */

/** The most shared teams one invitation may record. Above this the invitation is refused, never truncated. */
export const MAX_TEAM_BINDINGS = 10;

export interface TeamBinding {
  /** The owner's `teamMemberships.memberRef` in the team at binding time. */
  ownerMemberRef: string;
  /** The participant's `teamMemberships.memberRef` in the team at binding time. */
  participantMemberRef: string;
}

/** Keyed by team id. Non-empty, at most `MAX_TEAM_BINDINGS` entries. */
export type TeamBindingMap = Record<string, TeamBinding>;

const BINDING_KEYS = ["ownerMemberRef", "participantMemberRef"] as const;

/** A team id is one document-path segment (no `/`, not `.`/`..`, not the reserved `__…__` form). */
export function isBindingTeamId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("/") &&
    value !== "." &&
    value !== ".." &&
    !/^__.*__$/.test(value)
  );
}

/**
 * Strict validation of a stored binding map. Returns `null` for anything malformed: a non-object, an empty or oversized
 * map, an invalid team id, a binding with extra or missing keys, or a malformed reference. Malformed data is never repaired.
 */
export function parseTeamBindingMap(raw: unknown): TeamBindingMap | null {
  if (!isPlainObject(raw)) return null;
  const teamIds = Object.keys(raw);
  if (teamIds.length === 0 || teamIds.length > MAX_TEAM_BINDINGS) return null;

  const map: TeamBindingMap = {};
  for (const teamId of teamIds) {
    if (!isBindingTeamId(teamId)) return null;
    const binding = raw[teamId];
    if (!isPlainObject(binding) || !hasExactKeys(binding, BINDING_KEYS)) return null;
    const { ownerMemberRef, participantMemberRef } = binding;
    if (!isMemberRef(ownerMemberRef) || !isMemberRef(participantMemberRef)) return null;
    map[teamId] = { ownerMemberRef, participantMemberRef };
  }
  return map;
}

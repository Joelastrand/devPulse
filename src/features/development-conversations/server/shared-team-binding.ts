import "server-only";
import { isMemberRef, memberRefOf } from "../../teams/domain/member-ref";
import { extractMemberUid, isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import { MAX_TEAM_BINDINGS, parseTeamBindingMap, type TeamBindingMap } from "../domain/team-bindings";
import {
  createFirestoreMembershipRefReader,
  createFirestoreTeamChoiceReader,
  createFirestoreTeamEligibilityReader,
  isTeamIdSegment,
  readGenuineActiveMembership,
  type MembershipRefReader,
  type RawOwnMembership,
  type TeamEligibilityReader,
} from "./team-eligibility";

/**
 * Shared-team eligibility for private conversations (A2.1, revised). A conversation has no team. An invitation records, per
 * team, the owner's and the colleague's membership-instance references in every active team the two people share at that
 * moment. Access is authorized while at least one recorded team still holds: it is active, both people are genuine members,
 * and each current `memberRef` equals the recorded one.
 *
 * Consequences, all enforced here:
 * - losing one recorded team does not revoke access while another recorded team holds;
 * - leaving and rejoining (a new `memberRef`) does not restore access through that team;
 * - a team that becomes shared later is never added to an existing binding;
 * - when no recorded team holds, access is denied until a fresh invitation is accepted.
 *
 * Every decision re-reads the current documents, so a change takes effect on the next protected request. Denials are
 * `not_eligible`. Failed reads are `read_failed` and are never collapsed into a denial. A client-supplied team, uid or map is
 * never evidence. The binding map is read from the stored document and validated before use.
 */

/** The owner's memberships read per invitation. Owners above this are refused, never truncated. */
export const MAX_OWNER_MEMBERSHIPS = 50;

/** The reads this module needs. Production uses Firestore; tests use in-memory fakes. */
export interface OwnMembershipListReader {
  /** At most `limit` raw `teamMemberships` documents whose `uid` is `uid`. Unvalidated. */
  listOwnMemberships(uid: string, limit: number): Promise<RawOwnMembership[]>;
}

export type SharedTeamReader = TeamEligibilityReader & MembershipRefReader & OwnMembershipListReader;

export type SharedTeamError = "not_eligible" | "read_failed";

/** The production reader: point reads, the membership-by-reference lookup and the owner's bounded membership list. */
export function createFirestoreSharedTeamReader(): SharedTeamReader {
  return {
    ...createFirestoreTeamEligibilityReader(),
    ...createFirestoreMembershipRefReader(),
    listOwnMemberships: createFirestoreTeamChoiceReader().listOwnMemberships,
  };
}

/** A colleague chosen by the owner, with the bindings derived from the teams the two people share right now. */
export interface BoundColleague {
  uid: string;
  bindings: TeamBindingMap;
}

/** One membership instance that a binding names, for the transaction's coordination with membership destruction. */
export interface BoundMembership {
  uid: string;
  teamId: string;
  memberRef: string;
}

/**
 * Finds the membership document that carries `memberRef` and returns its uid. Zero or several matches are `not_eligible`.
 * The document must name its own id, uid and team consistently and carry exactly this ref. Malformed data is never repaired.
 */
async function colleagueUidOf(
  memberRef: string,
  reader: SharedTeamReader,
): Promise<{ ok: true; uid: string } | { ok: false; error: SharedTeamError }> {
  let rows: RawOwnMembership[];
  try {
    rows = await reader.findMembershipsByRef(memberRef, 2);
  } catch {
    return { ok: false, error: "read_failed" };
  }
  if (rows.length !== 1) return { ok: false, error: "not_eligible" };

  const [row] = rows;
  const uid = extractMemberUid(row.data);
  const teamId = typeof row.data === "object" && row.data !== null ? (row.data as Record<string, unknown>).teamId : undefined;
  if (uid === null || typeof teamId !== "string" || !isTeamIdSegment(teamId)) return { ok: false, error: "not_eligible" };
  if (row.id !== membershipDocId(uid, teamId) || !isValidMembershipFor(row.data, { uid, teamId })) {
    return { ok: false, error: "not_eligible" };
  }
  if (memberRefOf(row.data) !== memberRef) return { ok: false, error: "not_eligible" };
  return { ok: true, uid };
}

/**
 * Both people hold a genuine membership of `teamId` in an active team. Returns each one's current `memberRef` for that team.
 * A missing reference on either side is `not_eligible`, because a binding cannot name an instance without one.
 */
async function genuineRefsInTeam(
  ownerUid: string,
  personUid: string,
  teamId: string,
  reader: TeamEligibilityReader,
): Promise<{ ok: true; ownerRef: string; personRef: string } | { ok: false; error: SharedTeamError }> {
  const owner = await readGenuineActiveMembership(ownerUid, teamId, reader);
  if (!owner.ok) return { ok: false, error: owner.error };
  const person = await readGenuineActiveMembership(personUid, teamId, reader);
  if (!person.ok) return { ok: false, error: person.error };
  if (owner.memberRef === null || person.memberRef === null) return { ok: false, error: "not_eligible" };
  return { ok: true, ownerRef: owner.memberRef, personRef: person.memberRef };
}

/**
 * The team ids of the owner's own genuine memberships in the bounded list. A row that is not a well-formed membership of
 * the owner is skipped: it cannot create a binding, and it cannot widen one.
 */
export function ownerTeamIds(ownerUid: string, rows: RawOwnMembership[]): string[] {
  const teamIds = new Set<string>();
  for (const row of rows) {
    const teamId = typeof row.data === "object" && row.data !== null ? (row.data as Record<string, unknown>).teamId : undefined;
    if (typeof teamId !== "string" || !isTeamIdSegment(teamId)) continue;
    if (row.id !== membershipDocId(ownerUid, teamId) || !isValidMembershipFor(row.data, { uid: ownerUid, teamId })) continue;
    teamIds.add(teamId);
  }
  return [...teamIds].sort();
}

/**
 * Derives the bindings for an invitation: every active team in which the owner and the colleague both hold a genuine
 * membership. Zero qualifying teams, or more than `MAX_TEAM_BINDINGS`, is `not_eligible`. Nothing is truncated.
 */
async function deriveBindings(
  ownerUid: string,
  colleagueUid: string,
  reader: SharedTeamReader,
): Promise<{ ok: true; bindings: TeamBindingMap } | { ok: false; error: SharedTeamError }> {
  let rows: RawOwnMembership[];
  try {
    rows = await reader.listOwnMemberships(ownerUid, MAX_OWNER_MEMBERSHIPS + 1);
  } catch {
    return { ok: false, error: "read_failed" };
  }
  if (rows.length > MAX_OWNER_MEMBERSHIPS) return { ok: false, error: "not_eligible" };

  const bindings: TeamBindingMap = {};
  for (const teamId of ownerTeamIds(ownerUid, rows)) {
    const refs = await genuineRefsInTeam(ownerUid, colleagueUid, teamId, reader);
    if (!refs.ok) {
      if (refs.error === "read_failed") return { ok: false, error: "read_failed" };
      continue;
    }
    bindings[teamId] = { ownerMemberRef: refs.ownerRef, participantMemberRef: refs.personRef };
  }

  const count = Object.keys(bindings).length;
  if (count === 0 || count > MAX_TEAM_BINDINGS) return { ok: false, error: "not_eligible" };
  return { ok: true, bindings };
}

export type ColleagueRefResult = { ok: true; colleague: BoundColleague } | { ok: false; error: SharedTeamError };

/**
 * Write boundary for invitation and replacement (BR-9, BR-10, BR-11). The owner selects a colleague by a `memberRef`, which
 * names one of the colleague's memberships. The colleague must not be the owner. The bindings are then derived from every
 * team the owner and the colleague currently share. The write transaction calls `confirmBoundColleague` before it writes.
 */
export async function resolveColleagueRef(ownerUid: string, memberRef: unknown, reader: SharedTeamReader): Promise<ColleagueRefResult> {
  if (!isMemberRef(memberRef)) return { ok: false, error: "not_eligible" };
  const named = await colleagueUidOf(memberRef, reader);
  if (!named.ok) return named;
  if (named.uid === ownerUid) return { ok: false, error: "not_eligible" };

  const derived = await deriveBindings(ownerUid, named.uid, reader);
  if (!derived.ok) return derived;
  return { ok: true, colleague: { uid: named.uid, bindings: derived.bindings } };
}

/**
 * Transaction revalidation of a colleague chosen outside the transaction (BR-48). Every recorded binding must still hold, read
 * through the transaction's reader. A changed, removed or newly failing binding is refused. Failing closed here means a
 * concurrent change cancels the invitation, which the owner can repeat.
 */
export async function confirmBoundColleague(
  ownerUid: string,
  colleague: BoundColleague,
  reader: TeamEligibilityReader,
): Promise<{ ok: true } | { ok: false; error: SharedTeamError }> {
  if (colleague.uid === ownerUid) return { ok: false, error: "not_eligible" };
  for (const [teamId, binding] of Object.entries(colleague.bindings)) {
    const refs = await genuineRefsInTeam(ownerUid, colleague.uid, teamId, reader);
    if (!refs.ok) return refs;
    if (refs.ownerRef !== binding.ownerMemberRef || refs.personRef !== binding.participantMemberRef) {
      return { ok: false, error: "not_eligible" };
    }
  }
  return { ok: true };
}

/** Every membership instance a binding names, for `touchMembership` in the write transaction (TASK-038, I-7). */
export function boundMemberships(ownerUid: string, colleague: BoundColleague): BoundMembership[] {
  return Object.entries(colleague.bindings).flatMap(([teamId, binding]) => [
    { uid: ownerUid, teamId, memberRef: binding.ownerMemberRef },
    { uid: colleague.uid, teamId, memberRef: binding.participantMemberRef },
  ]);
}

export type BoundParticipantResult = { ok: true; teamId: string } | { ok: false; error: SharedTeamError };

/**
 * Per-request access check for a bound participant (BR-21 (d) and (e), A2.1 revised). The stored binding map is validated, and
 * access is granted by the first recorded team that still holds, in a deterministic order. Teams are checked one at a time,
 * so a read failure in one team cannot hide a team that holds. A read failure with no holding team is `read_failed`.
 */
export async function authorizeBoundParticipant(
  ownerUid: string,
  participantUid: string,
  storedBindings: unknown,
  reader: TeamEligibilityReader,
): Promise<BoundParticipantResult> {
  const bindings = parseTeamBindingMap(storedBindings);
  if (bindings === null) return { ok: false, error: "not_eligible" };

  let sawReadFailure = false;
  for (const teamId of Object.keys(bindings).sort()) {
    const binding = bindings[teamId];
    const refs = await genuineRefsInTeam(ownerUid, participantUid, teamId, reader);
    if (!refs.ok) {
      if (refs.error === "read_failed") sawReadFailure = true;
      continue;
    }
    if (refs.ownerRef === binding.ownerMemberRef && refs.personRef === binding.participantMemberRef) {
      return { ok: true, teamId };
    }
  }
  return { ok: false, error: sawReadFailure ? "read_failed" : "not_eligible" };
}

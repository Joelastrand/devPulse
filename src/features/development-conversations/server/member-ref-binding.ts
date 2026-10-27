import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { isMemberRef, resolveMemberRef } from "../../teams/domain/member-ref";
import { extractMemberUid } from "../../teams/domain/team-membership";
import {
  createFirestoreTeamEligibilityReader,
  readGenuineActiveMembership,
  type TeamEligibilityError,
  type TeamEligibilityReader,
} from "./team-eligibility";

const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * Members of one team that the owner can select (BR-8, BR-36). One extra document is requested to detect truncation.
 * Duplicated from the teams list read on purpose: D2 does not import from the teams server folder.
 */
export const SELECTABLE_MEMBERS_MAX = 500;

/**
 * The raw reads this module needs: the TASK-006 team and membership reads, plus one bounded membership list. Production
 * reads Firestore; tests use in-memory fakes.
 */
export interface ParticipantRefReader extends TeamEligibilityReader {
  /** Up to `limit` raw `teamMemberships` documents of one team (single-field equality, no composite index). Unvalidated. */
  listMemberships(teamId: string, limit: number): Promise<unknown[]>;
}

/**
 * `invalid_participant` covers every selection that cannot be resolved (BR-8). `persistence_failed` is an operational
 * read failure, kept apart so that it is never reported as an ineligible or unknown reference (SPEC "Stable errors").
 */
export type ParticipantRefError = "invalid_participant" | "persistence_failed";

/**
 * `memberRef` is an equality check on a membership that the owner has just verified. It is not authorization on its
 * own, and `candidateUid` is for server use only: it must never reach a client.
 */
export type ResolvedParticipantRef =
  | { ok: true; candidateUid: string; memberRef: string }
  | { ok: false; error: ParticipantRefError };

/**
 * Freshness check for membership-instance binding (BR-21(e), CL-23). Returns true only when the current membership's
 * `memberRef` is a valid ref equal to `storedRef`. Two absent refs never match, and a missing or malformed value on
 * either side is a mismatch. It reads no `role`, admin status, uid, name or e-mail, and it grants nothing alone: callers
 * must also have verified the uid, the active team and the current genuine membership.
 */
export function bindingMatches(storedRef: unknown, currentMembership: { memberRef: unknown }): boolean {
  const currentRef = currentMembership.memberRef;
  return isMemberRef(storedRef) && isMemberRef(currentRef) && storedRef === currentRef;
}

function eligibilityFailure(error: TeamEligibilityError): ParticipantRefError {
  return error === "read_failed" ? "persistence_failed" : "invalid_participant";
}

/**
 * Resolves the owner's selected `memberRef` to a candidate uid (BR-8, BR-9, BR-32, AD-11). The owner must be an eligible
 * genuine member of `teamId`. The reference is resolved against one bounded membership list. The candidate must not be
 * the owner and must pass the same TASK-006 check. The candidate's current `memberRef` must still equal the resolved one.
 */
export async function resolveParticipantRef(
  ownerUid: string,
  teamId: string,
  memberRef: unknown,
  reader: ParticipantRefReader,
): Promise<ResolvedParticipantRef> {
  const owner = await readGenuineActiveMembership(ownerUid, teamId, reader);
  if (!owner.ok) {
    return { ok: false, error: eligibilityFailure(owner.error) };
  }

  if (!isMemberRef(memberRef)) {
    return { ok: false, error: "invalid_participant" };
  }

  let rawMemberships: unknown[];
  try {
    rawMemberships = await reader.listMemberships(teamId, SELECTABLE_MEMBERS_MAX + 1);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  // A match beyond the 500-member window is not selectable (BR-8). A duplicate ref inside the window fails closed.
  const window = rawMemberships.slice(0, SELECTABLE_MEMBERS_MAX);
  const match = resolveMemberRef(window, teamId, memberRef);
  if (match === null) {
    return { ok: false, error: "invalid_participant" };
  }

  const candidateUid = extractMemberUid(match);
  if (candidateUid === null || candidateUid === ownerUid) {
    return { ok: false, error: "invalid_participant" };
  }

  const candidate = await readGenuineActiveMembership(candidateUid, teamId, reader);
  if (!candidate.ok) {
    return { ok: false, error: eligibilityFailure(candidate.error) };
  }
  if (!bindingMatches(memberRef, candidate)) {
    return { ok: false, error: "invalid_participant" };
  }

  return { ok: true, candidateUid, memberRef };
}

/** The production reader: the TASK-006 team and membership reads, plus one bounded membership list. */
export function createFirestoreParticipantRefReader(): ParticipantRefReader {
  return {
    ...createFirestoreTeamEligibilityReader(),
    async listMemberships(teamId, limit) {
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .where("teamId", "==", teamId)
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => doc.data());
    },
  };
}

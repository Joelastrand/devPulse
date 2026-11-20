import "server-only";
import type { SharedTeamReader } from "./shared-team-binding";

/**
 * One request's memo of the raw team, membership and membership-by-reference reads (TASK-023 owner-list cost, A2.1). It
 * caches the read promises, not any decision: each caller still runs its own eligibility or binding check on the result. A
 * rejected read stays a rejection for every caller, so an operational failure is observed the same way everywhere in the
 * request.
 *
 * Create one per operation call and never keep it past that call. It holds no module-level state.
 */
export function requestScopedTeamReader(reader: SharedTeamReader): SharedTeamReader {
  const statuses = new Map<string, Promise<unknown>>();
  const memberships = new Map<string, Promise<unknown>>();
  const byRef = new Map<string, Promise<Awaited<ReturnType<SharedTeamReader["findMembershipsByRef"]>>>>();
  const ownRows = new Map<string, Promise<Awaited<ReturnType<SharedTeamReader["listOwnMemberships"]>>>>();
  return {
    getTeamStatus(teamId) {
      let status = statuses.get(teamId);
      if (status === undefined) {
        status = reader.getTeamStatus(teamId);
        statuses.set(teamId, status);
      }
      return status;
    },
    getMembership(uid, teamId) {
      // A JSON tuple, so no character in either id can make two different pairs share a key. A NUL delimiter would not:
      // the id grammars do not forbid it (assertUidSegment and isNonEmptyString accept any non-empty string).
      const key = JSON.stringify([uid, teamId]);
      let membership = memberships.get(key);
      if (membership === undefined) {
        membership = reader.getMembership(uid, teamId);
        memberships.set(key, membership);
      }
      return membership;
    },
    findMembershipsByRef(memberRef, limit) {
      const key = JSON.stringify([memberRef, limit]);
      let rows = byRef.get(key);
      if (rows === undefined) {
        rows = reader.findMembershipsByRef(memberRef, limit);
        byRef.set(key, rows);
      }
      return rows;
    },
    listOwnMemberships(uid, limit) {
      const key = JSON.stringify([uid, limit]);
      let rows = ownRows.get(key);
      if (rows === undefined) {
        rows = reader.listOwnMemberships(uid, limit);
        ownRows.set(key, rows);
      }
      return rows;
    },
  };
}

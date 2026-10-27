import "server-only";
import { getDisplayNames } from "../../profiles/server/get-display-names";
import { readGenuineActiveMembership, type TeamEligibilityReader } from "./team-eligibility";

/**
 * Roster-rule display names for owner reads (SPEC BR-41…BR-43, CL-20, AD-7, invariant 21; TASK-011). This module is the
 * single D2 call site of `getDisplayNames`, and it is not a lookup endpoint: it returns names only for the pairs a
 * caller asks about, and only when both parties hold an active genuine membership of the same team.
 *
 * A name is a presentation value. It never authorises anything. A failed membership or name read is an operational
 * failure for the whole request, never a silent `null` (BR-53 style: no partial result).
 */

export interface RosterNameRequest {
  /** The verified caller, who must hold an active membership of `teamId`. */
  viewerUid: string;
  teamId: string;
  /** The party whose name is asked for. It is shown only if this uid holds an active membership of `teamId` too. */
  subjectUid: string;
}

export interface RosterNameDeps {
  teamReader: TeamEligibilityReader;
  /** Production uses `getDisplayNames`; tests inject a fake. Returns names only for uids that have a valid profile. */
  getNames?: (uids: readonly string[]) => Promise<Map<string, string>>;
}

export type RosterLookup = { ok: true; displayNameOf(request: RosterNameRequest): string | null } | { ok: false };

/**
 * The production name lookup for roster-rule names. The owner selector read (SPEC Amendment 2026-10-19) takes its names
 * from here too, so `getDisplayNames` keeps exactly one D2 importer (this module). Callers must have checked owner
 * eligibility first; this function does not decide who may see a name.
 */
export function productionDisplayNames(uids: readonly string[]): Promise<Map<string, string>> {
  return getDisplayNames(uids);
}

/** A JSON tuple key, so no delimiter in an id can collide with another id. */
const tupleKey = (...parts: readonly string[]): string => JSON.stringify(parts);

/**
 * Resolves every requested pair in one pass: the membership reads are deduplicated per (uid, team), and the name lookup
 * is a single `getNames` call for the distinct subject uids that pass. The returned lookup never reads again.
 */
export async function resolveRosterNames(requests: readonly RosterNameRequest[], deps: RosterNameDeps): Promise<RosterLookup> {
  const getNames = deps.getNames ?? ((uids: readonly string[]) => getDisplayNames(uids));
  try {
    const memberships = new Map<string, boolean>();
    const uniquePairs = new Map<string, { uid: string; teamId: string }>();
    for (const request of requests) {
      uniquePairs.set(tupleKey(request.viewerUid, request.teamId), { uid: request.viewerUid, teamId: request.teamId });
      uniquePairs.set(tupleKey(request.subjectUid, request.teamId), { uid: request.subjectUid, teamId: request.teamId });
    }
    await Promise.all(
      [...uniquePairs.entries()].map(async ([key, pair]) => {
        const membership = await readGenuineActiveMembership(pair.uid, pair.teamId, deps.teamReader);
        // A failed read is operational; a not-eligible result is simply an inactive membership (BR-41, BR-43).
        if (!membership.ok && membership.error === "read_failed") throw new Error("roster membership read failed");
        memberships.set(key, membership.ok);
      }),
    );

    const approved = new Set<string>();
    for (const request of requests) {
      const viewerActive = memberships.get(tupleKey(request.viewerUid, request.teamId)) === true;
      const subjectActive = memberships.get(tupleKey(request.subjectUid, request.teamId)) === true;
      if (viewerActive && subjectActive) {
        approved.add(tupleKey(request.viewerUid, request.teamId, request.subjectUid));
      }
    }

    const subjectUids = [...new Set(requests.filter((r) => approved.has(tupleKey(r.viewerUid, r.teamId, r.subjectUid))).map((r) => r.subjectUid))];
    const names = subjectUids.length === 0 ? new Map<string, string>() : await getNames(subjectUids);

    return {
      ok: true,
      displayNameOf(request) {
        if (!approved.has(tupleKey(request.viewerUid, request.teamId, request.subjectUid))) return null;
        return names.get(request.subjectUid) ?? null;
      },
    };
  } catch {
    return { ok: false };
  }
}

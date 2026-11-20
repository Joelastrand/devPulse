import "server-only";
import { productionDisplayNames } from "./participant-presentation";
import { memberRefOf } from "../../teams/domain/member-ref";
import { extractMemberUid, isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import { MAX_OWNER_MEMBERSHIPS, createFirestoreSharedTeamReader, ownerTeamIds, type SharedTeamReader } from "./shared-team-binding";
import {
  createFirestoreTeamMemberListReader,
  readGenuineActiveMembership,
  type RawOwnMembership,
  type TeamMemberListReader,
} from "./team-eligibility";

/**
 * The eligible-colleague source for the invitation picker (A2.1 revised, SPEC BR-9). Returns the people the caller may invite:
 * every person who holds a genuine membership of an active team the caller also holds a genuine membership of. The caller is
 * never listed. Each colleague appears once, however many shared teams they share.
 *
 * Output is minimal: an opaque team-scoped `memberRef` (the handle the invitation takes) and a display name, or `null`. No uid,
 * e-mail, team id or role is returned. A colleague with no readable name is listed with `null`, never with a fabricated name.
 *
 * Bounds. At most `MAX_OWNER_MEMBERSHIPS` of the caller's memberships are read, at most `MAX_MEMBERS_PER_TEAM` members per team,
 * and at most `MAX_COLLEAGUES` results. Anything beyond a bound sets `truncated`. Nothing is silently dropped without that flag.
 * A failed read fails the whole listing (`read_failed`); a partial list is never presented as complete.
 */

/** Members read per shared team. A larger team sets `truncated`. */
export const MAX_MEMBERS_PER_TEAM = 100;
/** Distinct colleagues returned. More sets `truncated`. */
export const MAX_COLLEAGUES = 200;

export interface EligibleColleague {
  /** The opaque membership reference the invitation takes. Team-scoped, never authorization on its own. */
  memberRef: string;
  displayName: string | null;
}

export type ColleagueListResult =
  | { ok: true; colleagues: EligibleColleague[]; truncated: boolean }
  | { ok: false; error: "read_failed" };

export interface ColleagueListDeps {
  reader: SharedTeamReader;
  members: TeamMemberListReader;
  /** Display names for the given uids. A missing or unreadable name is absent from the map. A rejection fails the listing. */
  getNames: (uids: readonly string[]) => Promise<Map<string, string>>;
}

export function defaultColleagueListDeps(): ColleagueListDeps {
  return {
    reader: createFirestoreSharedTeamReader(),
    members: createFirestoreTeamMemberListReader(),
    getNames: (uids) => productionDisplayNames(uids),
  };
}

const READ_FAILED: ColleagueListResult = { ok: false, error: "read_failed" };

/** A member row of one team that is a genuine membership of `teamId` for someone other than the caller. */
function colleagueOfRow(row: RawOwnMembership, teamId: string, ownerUid: string): { uid: string; memberRef: string } | null {
  const uid = extractMemberUid(row.data);
  if (uid === null || uid === ownerUid) return null;
  if (row.id !== membershipDocId(uid, teamId) || !isValidMembershipFor(row.data, { uid, teamId })) return null;
  const memberRef = memberRefOf(row.data);
  return memberRef === null ? null : { uid, memberRef };
}

export async function listEligibleColleagues(ownerUid: string, deps: ColleagueListDeps): Promise<ColleagueListResult> {
  let ownRows: RawOwnMembership[];
  try {
    ownRows = await deps.reader.listOwnMemberships(ownerUid, MAX_OWNER_MEMBERSHIPS + 1);
  } catch {
    return READ_FAILED;
  }
  let truncated = ownRows.length > MAX_OWNER_MEMBERSHIPS;

  // The same team derivation as the invitation's bindings, so the picker never offers someone the invitation would refuse.
  const teamIds = ownerTeamIds(ownerUid, ownRows.slice(0, MAX_OWNER_MEMBERSHIPS));
  const colleagueRefs = new Map<string, string>();

  for (const teamId of teamIds) {
    const owner = await readGenuineActiveMembership(ownerUid, teamId, deps.reader);
    if (!owner.ok) {
      if (owner.error === "read_failed") return READ_FAILED;
      continue;
    }

    let members: RawOwnMembership[];
    try {
      members = await deps.members.listTeamMemberships(teamId, MAX_MEMBERS_PER_TEAM + 1);
    } catch {
      return READ_FAILED;
    }
    if (members.length > MAX_MEMBERS_PER_TEAM) truncated = true;

    for (const row of members.slice(0, MAX_MEMBERS_PER_TEAM)) {
      const colleague = colleagueOfRow(row, teamId, ownerUid);
      if (colleague === null || colleagueRefs.has(colleague.uid)) continue;
      if (colleagueRefs.size >= MAX_COLLEAGUES) {
        truncated = true;
        break;
      }
      colleagueRefs.set(colleague.uid, colleague.memberRef);
    }
  }

  const uids = [...colleagueRefs.keys()];
  let names: Map<string, string>;
  try {
    names = uids.length === 0 ? new Map() : await deps.getNames(uids);
  } catch {
    return READ_FAILED;
  }

  const colleagues: EligibleColleague[] = [...colleagueRefs].map(([uid, memberRef]) => {
    const name = names.get(uid)?.trim() ?? "";
    return { memberRef, displayName: name.length > 0 ? name : null };
  });
  colleagues.sort((a, b) => {
    if (a.displayName === null || b.displayName === null) {
      if (a.displayName === b.displayName) return a.memberRef.localeCompare(b.memberRef);
      return a.displayName === null ? 1 : -1;
    }
    return a.displayName.localeCompare(b.displayName, "nb") || a.memberRef.localeCompare(b.memberRef);
  });
  return { ok: true, colleagues, truncated };
}

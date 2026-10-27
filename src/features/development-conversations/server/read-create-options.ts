import "server-only";
import { READ_WINDOW } from "../domain/conversation-constants";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import {
  createFirestoreTeamChoiceReader,
  isActiveTeamStatus,
  isTeamIdSegment,
  type RawOwnMembership,
  type TeamChoiceReader,
} from "./team-eligibility";

/**
 * The teams the caller may choose for a new conversation (SPEC create-options contract, TASK-027 amendment). Discovery
 * only: the result grants nothing, and `create` re-checks the same membership and status rule on every request.
 *
 * The subject is the verified uid only. A team is returned when the caller's own membership document is valid for the
 * exact (uid, teamId) pair and the team is `active` with a non-blank name. Role, lead status and app-admin status are
 * never read, so they neither qualify nor disqualify a team, and app-admin visibility is not a membership.
 *
 * Bounded: one `uid` query with `READ_WINDOW + 1` as its limit. Every raw row in the window consumes a slot, valid or not,
 * and there is no refill. A malformed row, an id mismatch, a disabled or unnamed team is omitted and never widens the
 * result. A failed read is `persistence_failed`, never an empty list.
 */

export interface CreateTeamChoice {
  teamId: string;
  name: string;
}

export interface CreateOptionsDeps {
  reader: TeamChoiceReader;
}

export type ReadCreateOptionsResult =
  | { ok: true; items: CreateTeamChoice[]; truncated: boolean }
  | { ok: false; error: "persistence_failed" };

const FAILED: ReadCreateOptionsResult = { ok: false, error: "persistence_failed" };

function defaultDeps(): CreateOptionsDeps {
  return { reader: createFirestoreTeamChoiceReader() };
}

/** The team id of a membership row, when the row is a valid membership of exactly this caller. Otherwise `null`. */
function ownMembershipTeamId(uid: string, row: RawOwnMembership): string | null {
  const data = row.data;
  if (typeof data !== "object" || data === null) return null;
  const teamId = (data as Record<string, unknown>).teamId;
  if (typeof teamId !== "string" || !isTeamIdSegment(teamId)) return null;
  if (row.id !== membershipDocId(uid, teamId)) return null;
  return isValidMembershipFor(data, { uid, teamId }) ? teamId : null;
}

/** The display name of an active team with a non-blank name. Otherwise `null`. */
function activeTeamName(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (!isActiveTeamStatus(record.status)) return null;
  return typeof record.name === "string" && record.name.trim().length > 0 ? record.name : null;
}

function byNameThenId(a: CreateTeamChoice, b: CreateTeamChoice): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.teamId !== b.teamId) return a.teamId < b.teamId ? -1 : 1;
  return 0;
}

export async function readCreateOptions(
  uid: string,
  deps: CreateOptionsDeps = defaultDeps(),
): Promise<ReadCreateOptionsResult> {
  let rows: RawOwnMembership[];
  try {
    rows = await deps.reader.listOwnMemberships(uid, READ_WINDOW + 1);
  } catch {
    return FAILED;
  }

  const truncated = rows.length > READ_WINDOW;
  const teamIds = new Set<string>();
  for (const row of rows.slice(0, READ_WINDOW)) {
    const teamId = ownMembershipTeamId(uid, row);
    if (teamId !== null) teamIds.add(teamId);
  }

  const ids = [...teamIds];
  if (ids.length === 0) return { ok: true, items: [], truncated };

  let records: unknown[];
  try {
    records = await deps.reader.getTeams(ids);
  } catch {
    return FAILED;
  }

  const items: CreateTeamChoice[] = [];
  ids.forEach((teamId, index) => {
    const name = activeTeamName(records[index]);
    if (name !== null) items.push({ teamId, name });
  });
  items.sort(byNameThenId);
  return { ok: true, items, truncated };
}

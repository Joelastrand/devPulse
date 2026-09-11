import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  verifyIdToken,
  type VerifyIdTokenDeps,
} from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../domain/app-admin";
import { isValidTeamStatus } from "../domain/team";
import { isValidAccessRequestStatus } from "../domain/team-access-request";
import {
  listActiveTeams,
  type ActiveTeamsCollection,
} from "./list-active-teams";
import {
  resolveInvitations,
  type ResolveInvitationsCollection,
} from "./resolve-invitations";

const MEMBERSHIPS_COLLECTION = "teamMemberships";
const REQUESTS_COLLECTION = "teamAccessRequests";
const TEAMS_COLLECTION = "teams";

export type TeamRelationship =
  | "admin"
  | "member"
  | "request_pending"
  | "request_rejected"
  | "none";

/**
 * The minimal, non-sensitive shape one row of `/teams` shows
 * (docs/features/team-management/SPEC.md — BR-11): never a member list,
 * invitation list, another user's relationship, or any result/aggregate
 * data.
 */
export interface TeamOverviewEntry {
  teamId: string;
  name: string;
  relationship: TeamRelationship;
}

/**
 * The read seam this operation depends on, satisfied in production by two
 * single-field Firestore queries plus an on-demand team-document read, and
 * by an in-memory fake in tests. Returns raw, unvalidated document data —
 * `getTeamsOverview` validates it before trusting it.
 */
export interface TeamsOverviewCollection {
  /** Every raw `teamMemberships` document for this uid, regardless of team. */
  listMembershipsForUser(uid: string): Promise<unknown[]>;
  /** Every raw `teamAccessRequests` document for this uid, regardless of team. */
  listAccessRequestsForUser(uid: string): Promise<unknown[]>;
  /** Raw `teams/{teamId}` document data, or `undefined` if it doesn't exist. */
  getTeam(teamId: string): Promise<unknown>;
}

function getDefaultCollection(): TeamsOverviewCollection {
  const db = getFirestoreDb();
  return {
    async listMembershipsForUser(uid) {
      const snapshot = await db
        .collection(MEMBERSHIPS_COLLECTION)
        .where("uid", "==", uid)
        .get();
      return snapshot.docs.map((doc) => doc.data());
    },
    async listAccessRequestsForUser(uid) {
      const snapshot = await db
        .collection(REQUESTS_COLLECTION)
        .where("uid", "==", uid)
        .get();
      return snapshot.docs.map((doc) => doc.data());
    },
    async getTeam(teamId) {
      const snapshot = await db.collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

export type GetTeamsOverviewResult =
  | { ok: true; teams: TeamOverviewEntry[] }
  | { ok: false; error: "unauthenticated" | "read_failed" };

export interface GetTeamsOverviewDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  activeTeamsCollection?: ActiveTeamsCollection;
  resolveInvitationsCollection?: ResolveInvitationsCollection;
  collection?: TeamsOverviewCollection;
}

function readTeamId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const teamId = (raw as Record<string, unknown>).teamId;
  return typeof teamId === "string" && teamId.length > 0 ? teamId : null;
}

/**
 * Loads the authenticated caller's `/teams` overview
 * (docs/features/team-management/SPEC.md — BR-11 through BR-13). Identity
 * always comes from a revocation-checked `verifyIdToken` — never a
 * client-supplied uid/email/admin flag.
 *
 * Order of operations mirrors SPEC's edge case ("pending invitation ...
 * resolution runs as part of that same request before the relationship is
 * computed"): pending invitations are resolved first via
 * `resolveInvitations` (reused unchanged), then relationships are computed
 * from the resulting Firestore state — so a newly created membership is
 * reflected in the same response.
 *
 * Returns one entry per `active` team, plus any additional team (active or
 * disabled) the caller has an actual `teamMemberships` or
 * `teamAccessRequests` document for — so an existing member or requester
 * never loses visibility of a team an admin has since disabled (SPEC →
 * TASK-007 outcome). An app admin's blanket "admin" relationship does not,
 * by itself, pull in every disabled team — that full-catalog view belongs
 * to the separate admin-only `listTeams` operation (TASK-009).
 *
 * A malformed/unreadable team, membership, or access-request document is
 * excluded rather than trusted (fail closed) — this never causes the whole
 * read to fail. A genuine Firestore read failure (here or during invitation
 * resolution) fails the whole result closed as `read_failed`, never a
 * partial or stale list.
 */
export async function getTeamsOverview(
  idToken: string,
  deps: GetTeamsOverviewDeps = {},
): Promise<GetTeamsOverviewResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }
  const identity = verified.identity;

  const resolveResult = await resolveInvitations(identity, {
    now: deps.now,
    collection: deps.resolveInvitationsCollection,
  });
  if (!resolveResult.ok) {
    return { ok: false, error: "read_failed" };
  }

  const activeResult = await listActiveTeams({ collection: deps.activeTeamsCollection });
  if (!activeResult.ok) {
    return { ok: false, error: "read_failed" };
  }

  const collection = deps.collection ?? getDefaultCollection();
  const admin = isAppAdmin(identity, { allowList: deps.allowList });

  let rawMemberships: unknown[];
  let rawAccessRequests: unknown[];
  try {
    [rawMemberships, rawAccessRequests] = await Promise.all([
      collection.listMembershipsForUser(identity.uid),
      collection.listAccessRequestsForUser(identity.uid),
    ]);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const membershipTeamIds = new Set<string>();
  for (const raw of rawMemberships) {
    const teamId = readTeamId(raw);
    if (teamId) {
      membershipTeamIds.add(teamId);
    }
  }

  const requestStatusByTeam = new Map<string, "pending" | "rejected">();
  for (const raw of rawAccessRequests) {
    const teamId = readTeamId(raw);
    if (!teamId || typeof raw !== "object" || raw === null) {
      continue;
    }
    const status = (raw as Record<string, unknown>).status;
    if (!isValidAccessRequestStatus(status)) {
      continue;
    }
    if (status === "pending" || status === "rejected") {
      requestStatusByTeam.set(teamId, status);
    }
  }

  function relationshipFor(teamId: string): TeamRelationship {
    if (admin) {
      return "admin";
    }
    if (membershipTeamIds.has(teamId)) {
      return "member";
    }
    const requestStatus = requestStatusByTeam.get(teamId);
    if (requestStatus === "pending") {
      return "request_pending";
    }
    if (requestStatus === "rejected") {
      return "request_rejected";
    }
    return "none";
  }

  const activeTeamIds = new Set(activeResult.teams.map((team) => team.teamId));
  const entries: TeamOverviewEntry[] = activeResult.teams.map((team) => ({
    teamId: team.teamId,
    name: team.name,
    relationship: relationshipFor(team.teamId),
  }));

  const extraTeamIds = new Set<string>();
  for (const teamId of membershipTeamIds) {
    if (!activeTeamIds.has(teamId)) {
      extraTeamIds.add(teamId);
    }
  }
  for (const teamId of requestStatusByTeam.keys()) {
    if (!activeTeamIds.has(teamId)) {
      extraTeamIds.add(teamId);
    }
  }

  for (const teamId of extraTeamIds) {
    let rawTeam: unknown;
    try {
      rawTeam = await collection.getTeam(teamId);
    } catch {
      return { ok: false, error: "read_failed" };
    }

    if (typeof rawTeam !== "object" || rawTeam === null) {
      continue;
    }
    const data = rawTeam as Record<string, unknown>;
    if (!isValidTeamStatus(data.status)) {
      continue;
    }
    if (typeof data.name !== "string" || data.name.trim().length === 0) {
      continue;
    }

    entries.push({ teamId, name: data.name, relationship: relationshipFor(teamId) });
  }

  return { ok: true, teams: entries };
}

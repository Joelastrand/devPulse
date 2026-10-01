import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { getDisplayNames, type ProfileBatchReader } from "../../profiles/server/get-display-names";
import { isValidTeamStatus } from "../domain/team";
import { extractMemberUid, membershipRoleOf } from "../domain/team-membership";
import { authorizeTeamAccess, type AuthorizeTeamAccessDeps } from "./authorize-team-access";

const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** Memberships read per roster call (docs/features/member-identity-and-team-roles/SPEC.md — BR-13). One extra is requested to detect truncation. */
export const TEAM_ROSTER_MAX_MEMBERS = 500;

/**
 * The member-facing roster entry — the **complete** public contract (SPEC —
 * BR-9, BR-14). Deliberately carries no `uid`, e-mail, membership document
 * id, team id, role-audit field or timestamp: a Forum `authorTag` is
 * `SHA-256(teamId:authorUid)`, so any member-visible value that exposes or
 * lets a client derive a `uid` would let a member re-identify Forum
 * authors. Entries are always constructed field by field — never by
 * spreading a membership or profile object.
 */
export interface TeamRosterEntry {
  displayName: string | null;
  isLead: boolean;
  isSelf: boolean;
}

export type ListTeamRosterResult =
  | { ok: true; members: TeamRosterEntry[]; truncated: boolean }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

/** Read seam for the roster's own reads, satisfied by Firestore in production and an in-memory fake in tests. */
export interface TeamRosterStore {
  /** Up to `limit` raw `teamMemberships` documents of one team, in a stable (document-id) order. Unvalidated. */
  listMemberships(teamId: string, limit: number): Promise<unknown[]>;
  /** Raw `teams/{teamId}.status`, or `undefined`. */
  getTeamStatus(teamId: string): Promise<unknown>;
}

function getDefaultStore(): TeamRosterStore {
  return {
    async listMemberships(teamId, limit) {
      // Single-field equality + limit: auto-indexed, no composite index.
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .where("teamId", "==", teamId)
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        const createdAt = data.createdAt;
        const asDate =
          typeof createdAt === "object" && createdAt !== null && typeof createdAt.toDate === "function"
            ? createdAt.toDate()
            : createdAt;
        return { ...data, createdAt: asDate };
      });
    },
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

export interface ListTeamRosterDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  /** Seam for `authorizeTeamAccess`'s own reads. */
  collection?: AuthorizeTeamAccessDeps["collection"];
  store?: TeamRosterStore;
  profileReader?: ProfileBatchReader;
}

interface RosterMember {
  uid: string;
  joinedAt: number;
  storedLead: boolean;
}

const NAME_COLLATOR = new Intl.Collator("nb", { sensitivity: "accent" });

/**
 * Lists one team's roster for a member or app admin (SPEC — BR-8 through
 * BR-15). Authorization is `authorizeTeamAccess` (`member`/`admin`;
 * `denied` ⇒ `forbidden`, a failed read ⇒ `read_failed`, never collapsed
 * into each other), re-derived on every call; the `teamId` is route context,
 * never trusted on its own, and only that team's memberships are read.
 *
 * Reads at most {@link TEAM_ROSTER_MAX_MEMBERS} memberships (truncating
 * deterministically by document order and reporting `truncated`), skips
 * malformed membership documents, and resolves names with one batched read
 * of the userProfiles of exactly those members — never Firebase Auth, never
 * e-mail. A member with no (or a corrupt) profile has `displayName: null`.
 *
 * `isLead` is an **effective** lead — a stored `role: "lead"` (classified by
 * `membershipRoleOf`) on a team whose status is exactly `"active"` — the same
 * definition `resolveTeamRole` uses, so a dormant lead on a disabled team is
 * not marked. `isSelf` is computed from the verified uid, which never leaves
 * the server. Order: leads first, then name (locale-aware, case-insensitive,
 * nameless last), then earlier join time. Presentation only: neither
 * `isLead` nor `displayName` is ever an authorization input.
 */
export async function listTeamRoster(
  idToken: string,
  teamId: string,
  deps: ListTeamRosterDeps = {},
): Promise<ListTeamRosterResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }
  const callerUid = verified.identity.uid;

  const authorized = await authorizeTeamAccess(verified.identity, teamId, {
    allowList: deps.allowList,
    collection: deps.collection,
  });
  if (!authorized.ok) {
    return { ok: false, error: "read_failed" };
  }
  if (authorized.access === "denied") {
    return { ok: false, error: "forbidden" };
  }

  const store = deps.store ?? getDefaultStore();

  try {
    const rawDocs = await store.listMemberships(teamId, TEAM_ROSTER_MAX_MEMBERS + 1);
    const truncated = rawDocs.length > TEAM_ROSTER_MAX_MEMBERS;

    const members = rawDocs.slice(0, TEAM_ROSTER_MAX_MEMBERS).flatMap((raw): RosterMember[] => {
      const uid = extractMemberUid(raw);
      if (uid === null || (raw as Record<string, unknown>).teamId !== teamId) {
        return [];
      }
      const createdAt = (raw as Record<string, unknown>).createdAt;
      return [
        {
          uid,
          joinedAt: createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : Infinity,
          storedLead: membershipRoleOf(raw) === "lead",
        },
      ];
    });

    // A stored lead is only effective while the team is active; one status
    // read, and only when someone actually carries the role.
    const teamActive = members.some((member) => member.storedLead)
      ? await readTeamIsActive(store, teamId)
      : false;

    const names = await getDisplayNames(
      members.map((member) => member.uid),
      { reader: deps.profileReader },
    );

    const entries = members
      .map((member) => ({
        joinedAt: member.joinedAt,
        displayName: names.get(member.uid) ?? null,
        isLead: member.storedLead && teamActive,
        isSelf: member.uid === callerUid,
      }))
      .sort(compareEntries)
      .map(({ displayName, isLead, isSelf }): TeamRosterEntry => ({ displayName, isLead, isSelf }));

    return { ok: true, members: entries, truncated };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

async function readTeamIsActive(store: TeamRosterStore, teamId: string): Promise<boolean> {
  const status = await store.getTeamStatus(teamId);
  return isValidTeamStatus(status) && status === "active";
}

interface SortableEntry {
  displayName: string | null;
  isLead: boolean;
  joinedAt: number;
}

function compareEntries(a: SortableEntry, b: SortableEntry): number {
  if (a.isLead !== b.isLead) {
    return a.isLead ? -1 : 1;
  }
  if (a.displayName !== b.displayName) {
    if (a.displayName === null) return 1;
    if (b.displayName === null) return -1;
    const byName = NAME_COLLATOR.compare(a.displayName, b.displayName);
    if (byName !== 0) return byName;
  }
  return a.joinedAt === b.joinedAt ? 0 : a.joinedAt < b.joinedAt ? -1 : 1;
}

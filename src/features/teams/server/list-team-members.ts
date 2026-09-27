import "server-only";
import { getAdminAuth, getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { extractMemberUid } from "../domain/team-membership";
import { requireAppAdmin } from "./require-app-admin";

const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** One member row for display: uid plus its current, live-resolved email. */
export interface TeamMember {
  uid: string;
  email: string | null;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore query and by an in-memory fake in tests. Returns raw,
 * unvalidated document data per member — `listTeamMembers` validates each
 * one before use (fail closed: an unreadable document is excluded, never
 * fabricated).
 */
export interface TeamMembersCollection {
  listRawForTeam(teamId: string): Promise<unknown[]>;
}

function getDefaultCollection(): TeamMembersCollection {
  return {
    async listRawForTeam(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .where("teamId", "==", teamId)
        .get();
      return snapshot.docs.map((doc) => doc.data());
    },
  };
}

type GetUser = (uid: string) => Promise<{ email?: string | null }>;

function defaultGetUser(uid: string) {
  return getAdminAuth().getUser(uid);
}

export type ListTeamMembersResult =
  | { ok: true; members: TeamMember[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface ListTeamMembersDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: TeamMembersCollection;
  getUser?: GetUser;
}

/**
 * Lists a team's members for an app admin (docs/features/team-management/
 * SPEC.md — BR-29). Each member's email is resolved live from Firebase
 * Auth per `uid` — never persisted on or read from the `teamMemberships`
 * document itself. A member whose document is malformed (no valid `uid`)
 * or whose `uid` no longer resolves to a live Firebase account is
 * excluded from the result rather than causing the whole list to fail or
 * fabricating a value.
 */
export async function listTeamMembers(
  idToken: string,
  teamId: string,
  deps: ListTeamMembersDeps = {},
): Promise<ListTeamMembersResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const collection = deps.collection ?? getDefaultCollection();
  const getUser = deps.getUser ?? defaultGetUser;

  let rawDocs: unknown[];
  try {
    rawDocs = await collection.listRawForTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const uids = rawDocs
    .map(extractMemberUid)
    .filter((uid): uid is string => uid !== null);

  // Concurrent, not sequential: each lookup keeps its own try/catch so one
  // uid's failure never affects a sibling lookup or the overall result
  // (`.map()`/`Promise.all` preserve `uids`' order in the resolved array
  // regardless of which lookup settles first — never re-derived from
  // resolution timing).
  const lookups = await Promise.all(
    uids.map(async (uid): Promise<TeamMember | null> => {
      try {
        const userRecord = await getUser(uid);
        return { uid, email: userRecord.email ?? null };
      } catch {
        // uid no longer resolves to a live Firebase account (e.g. the
        // account was deleted) — exclude rather than fabricate a value.
        return null;
      }
    }),
  );
  const members = lookups.filter((member): member is TeamMember => member !== null);

  return { ok: true, members };
}

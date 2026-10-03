import "server-only";
import { getAdminAuth, getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { getDisplayNames, type ProfileBatchReader } from "../../profiles/server/get-display-names";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { memberRefOf } from "../domain/member-ref";
import { extractMemberUid, membershipRoleOf, type MembershipRole } from "../domain/team-membership";
import { requireAppAdmin } from "./require-app-admin";

const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * One admin-only member row: uid plus its current, live-resolved email (the
 * existing admin identity), and — additively (docs/features/member-identity-
 * and-team-roles/SPEC.md — BR-29) — the member's self-set `displayName`
 * (`null` when they have no valid profile; never derived from e-mail) and the
 * **stored** team role. `role` is the membership's persisted role
 * (`membershipRoleOf`), not the effective `resolveTeamRole` result: a stored
 * lead on a disabled team is still `"lead"` here. This shape carries the
 * `uid` admin operations need and must never be reused for the member-facing
 * roster (`TeamRosterEntry`). `hasMemberRef` (docs/features/team-skill-
 * planning/SPEC.md — BR-5, BR-36) is only the readiness signal for the admin
 * "Klargjør medlemsvelger" action: whether the membership carries a valid
 * `memberRef`. The ref value itself is never returned.
 */
export interface TeamMember {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: MembershipRole;
  hasMemberRef: boolean;
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
  profileReader?: ProfileBatchReader;
}

/**
 * Lists a team's members for an app admin (docs/features/team-management/
 * SPEC.md — BR-29). Each member's email is resolved live from Firebase
 * Auth per `uid` — never persisted on or read from the `teamMemberships`
 * document itself. A member whose document is malformed (no valid `uid`)
 * or whose `uid` no longer resolves to a live Firebase account is
 * excluded from the result rather than causing the whole list to fail or
 * fabricating a value. Display names come from one batched `userProfiles`
 * read; a missing/corrupt profile is `null`, and — names being
 * presentation, not authorization — a failed profile read degrades every
 * name to `null` rather than blocking the admin's member management.
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

  const rows = rawDocs.flatMap((raw) => {
    const uid = extractMemberUid(raw);
    return uid === null ? [] : [{ uid, role: membershipRoleOf(raw), hasMemberRef: memberRefOf(raw) !== null }];
  });
  const namesPromise = getDisplayNames(
    rows.map((row) => row.uid),
    { reader: deps.profileReader },
  ).catch(() => new Map<string, string>());

  // Concurrent, not sequential: each lookup keeps its own try/catch so one
  // uid's failure never affects a sibling lookup or the overall result
  // (`.map()`/`Promise.all` preserve `rows`' order in the resolved array
  // regardless of which lookup settles first — never re-derived from
  // resolution timing).
  const [names, lookups] = await Promise.all([
    namesPromise,
    Promise.all(
      rows.map(async ({ uid, role, hasMemberRef }) => {
        try {
          const userRecord = await getUser(uid);
          return { uid, role, hasMemberRef, email: userRecord.email ?? null };
        } catch {
          // uid no longer resolves to a live Firebase account (e.g. the
          // account was deleted) — exclude rather than fabricate a value.
          return null;
        }
      }),
    ),
  ]);

  const members = lookups
    .filter((lookup): lookup is NonNullable<typeof lookup> => lookup !== null)
    .map(
      ({ uid, role, hasMemberRef, email }): TeamMember => ({
        uid,
        email,
        displayName: names.get(uid) ?? null,
        role,
        hasMemberRef,
      }),
    );

  return { ok: true, members };
}

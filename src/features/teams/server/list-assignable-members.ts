import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { getDisplayNames, type ProfileBatchReader } from "../../profiles/server/get-display-names";
import { arrangeAssignableMembers, type AssignableCandidate } from "../domain/assignable-ordinals";
import { memberRefOf } from "../domain/member-ref";
import { extractMemberUid } from "../domain/team-membership";
import { authorizeTeamAccess, type AuthorizeTeamAccessDeps } from "./authorize-team-access";

const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** Memberships read per call (SPEC — "Reads are bounded"). One extra is requested to detect truncation. */
export const ASSIGNABLE_MEMBERS_MAX = 500;

/**
 * One selectable member — the **complete** public contract (SPEC —
 * "Assignable-members contract"). `memberRef` is an opaque team-scoped
 * selection handle, never authorization. Deliberately carries no `uid`,
 * e-mail, membership document id, join date, role/lead flag or audit field;
 * entries are built field by field, never by spreading a stored object.
 */
export interface AssignableMember {
  memberRef: string;
  displayName: string | null;
  ordinal: number | null;
  isSelf: boolean;
}

export type ListAssignableMembersResult =
  | { ok: true; members: AssignableMember[]; unavailableCount: number; truncated: boolean }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

/** Read seam for this operation's own read; Firestore in production, an in-memory fake in tests. */
export interface AssignableMembersStore {
  /** Up to `limit` raw `teamMemberships` documents of one team (single-field equality query, no composite index). Unvalidated. */
  listMemberships(teamId: string, limit: number): Promise<unknown[]>;
}

function getDefaultStore(): AssignableMembersStore {
  return {
    async listMemberships(teamId, limit) {
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
  };
}

export interface ListAssignableMembersDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  /** Seam for `authorizeTeamAccess`'s own reads. */
  collection?: AuthorizeTeamAccessDeps["collection"];
  store?: AssignableMembersStore;
  profileReader?: ProfileBatchReader;
}

interface CurrentMember {
  uid: string;
  memberRef: string | null;
  joinedAt: number | null;
}

/**
 * Lists the members the caller may pick as a plan owner. Strictly read-only:
 * it never generates, repairs or persists a `memberRef` (TASK-002's explicit
 * preparation is the only writer).
 *
 * Authorization is the unmodified `authorizeTeamAccess` (`member`/`admin`;
 * `denied` ⇒ `forbidden`, a failed read ⇒ `read_failed`), re-derived on every
 * call; `teamId` is route context only and only that team's memberships are
 * read. An app admin without a membership may read but is not listed.
 *
 * Eligible = a well-formed membership of exactly this team with a valid,
 * **unique** `memberRef`. Members without a valid ref, and every member
 * whose ref is shared with another membership of the team (ambiguous — it
 * could never be resolved later), are omitted and counted, non-identifyingly,
 * in `unavailableCount`; nothing is repaired. Names come from the F0 profile
 * lookup (`null` when missing/corrupt — never e-mail or uid). Ordinals are
 * computed per response by `arrangeAssignableMembers` and never stored.
 */
export async function listAssignableMembers(
  idToken: string,
  teamId: string,
  deps: ListAssignableMembersDeps = {},
): Promise<ListAssignableMembersResult> {
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
    const rawDocs = await store.listMemberships(teamId, ASSIGNABLE_MEMBERS_MAX + 1);
    const truncated = rawDocs.length > ASSIGNABLE_MEMBERS_MAX;

    const current = rawDocs.slice(0, ASSIGNABLE_MEMBERS_MAX).flatMap((raw): CurrentMember[] => {
      const uid = extractMemberUid(raw);
      if (uid === null || (raw as Record<string, unknown>).teamId !== teamId) {
        return [];
      }
      const createdAt = (raw as Record<string, unknown>).createdAt;
      return [
        {
          uid,
          memberRef: memberRefOf(raw),
          joinedAt: createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : null,
        },
      ];
    });

    const refCounts = new Map<string, number>();
    for (const { memberRef } of current) {
      if (memberRef !== null) {
        refCounts.set(memberRef, (refCounts.get(memberRef) ?? 0) + 1);
      }
    }
    const eligible = current.filter(
      (member): member is CurrentMember & { memberRef: string } =>
        member.memberRef !== null && refCounts.get(member.memberRef) === 1,
    );

    const names = await getDisplayNames(
      eligible.map((member) => member.uid),
      { reader: deps.profileReader },
    );

    const candidates = eligible.map(
      (member): AssignableCandidate => ({
        memberRef: member.memberRef,
        displayName: names.get(member.uid) ?? null,
        joinedAt: member.joinedAt,
        isSelf: member.uid === callerUid,
      }),
    );

    const members = arrangeAssignableMembers(candidates).map(
      ({ memberRef, displayName, ordinal, isSelf }): AssignableMember => ({
        memberRef,
        displayName,
        ordinal,
        isSelf,
      }),
    );

    return { ok: true, members, unavailableCount: current.length - eligible.length, truncated };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

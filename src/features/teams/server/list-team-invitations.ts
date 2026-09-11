import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import { isValidPendingInvitationForTeam } from "../domain/team-invitation";
import { requireAppAdmin } from "./require-app-admin";

const INVITATIONS_COLLECTION = "teamInvitations";

/** One pending invitation row for admin display (BR-30). */
export interface PendingInvitation {
  email: string;
  invitedBy: string;
  createdAt: Date;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore query and by an in-memory fake in tests. Returns every raw
 * `teamInvitations` document for the team regardless of status —
 * `listTeamInvitations` filters to `"pending"` and validates each one
 * before use (fail closed: a malformed/non-pending document is excluded,
 * never fabricated).
 */
export interface TeamInvitationsCollection {
  listRawForTeam(teamId: string): Promise<unknown[]>;
}

function getDefaultCollection(): TeamInvitationsCollection {
  return {
    async listRawForTeam(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(INVITATIONS_COLLECTION)
        .where("teamId", "==", teamId)
        .get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          ...data,
          createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
        };
      });
    },
  };
}

export type ListTeamInvitationsResult =
  | { ok: true; invitations: PendingInvitation[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface ListTeamInvitationsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: TeamInvitationsCollection;
}

/**
 * Lists a team's pending invitations for an app admin
 * (docs/features/team-management/SPEC.md — BR-30). Filters to `"pending"`
 * only — accepted/canceled invitations are historical, not part of the
 * admin's actionable pending view.
 */
export async function listTeamInvitations(
  idToken: string,
  teamId: string,
  deps: ListTeamInvitationsDeps = {},
): Promise<ListTeamInvitationsResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const collection = deps.collection ?? getDefaultCollection();

  let rawDocs: unknown[];
  try {
    rawDocs = await collection.listRawForTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const invitations: PendingInvitation[] = rawDocs
    .filter((doc) => isValidPendingInvitationForTeam(doc, teamId))
    .map((doc) => ({ email: doc.email, invitedBy: doc.invitedBy, createdAt: doc.createdAt }));

  return { ok: true, invitations };
}

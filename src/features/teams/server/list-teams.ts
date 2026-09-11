import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import type { Team } from "../domain/team";
import { requireAppAdmin } from "./require-app-admin";

const COLLECTION_NAME = "teams";

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore collection read and by an in-memory fake in tests.
 */
export interface TeamListCollection {
  listAll(): Promise<Team[]>;
}

function getDefaultCollection(): TeamListCollection {
  return {
    async listAll() {
      const snapshot = await getFirestoreDb().collection(COLLECTION_NAME).get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          teamId: doc.id,
          name: data.name,
          status: data.status,
          createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
          createdBy: data.createdBy,
        } as Team;
      });
    },
  };
}

export type ListTeamsResult =
  | { ok: true; teams: Team[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface ListTeamsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: TeamListCollection;
}

/**
 * Lists every team, including `disabled` ones — an app-admin-only view
 * (docs/features/team-management/SPEC.md — TASK-009's "see every team,
 * including disabled ones"). Not for non-admin use: the public/authenticated
 * active-team listings (pulse-survey, `/teams`) are separate, more
 * restricted operations added by later tasks.
 */
export async function listTeams(
  idToken: string,
  deps: ListTeamsDeps = {},
): Promise<ListTeamsResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const collection = deps.collection ?? getDefaultCollection();

  try {
    const teams = await collection.listAll();
    return { ok: true, teams };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

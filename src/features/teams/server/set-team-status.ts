import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import type { TeamStatus } from "../domain/team";
import { requireAppAdmin } from "./require-app-admin";

const COLLECTION_NAME = "teams";

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore document update and by an in-memory fake in tests.
 */
export interface TeamStatusCollection {
  setStatus(teamId: string, status: TeamStatus): Promise<void>;
}

function getDefaultCollection(): TeamStatusCollection {
  return {
    async setStatus(teamId, status) {
      await getFirestoreDb()
        .collection(COLLECTION_NAME)
        .doc(teamId)
        .update({ status });
    },
  };
}

export type SetTeamStatusResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "forbidden" | "persistence_failed" };

export interface SetTeamStatusDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: TeamStatusCollection;
}

/**
 * Disables or re-enables a team. Only an app admin may call this
 * successfully (docs/features/team-management/SPEC.md — BR-2). Never
 * deletes or modifies any survey response data (BR-4) — this operation
 * touches only the `teams` document's `status` field.
 */
export async function setTeamStatus(
  idToken: string,
  teamId: string,
  status: TeamStatus,
  deps: SetTeamStatusDeps = {},
): Promise<SetTeamStatusResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const collection = deps.collection ?? getDefaultCollection();

  try {
    await collection.setStatus(teamId, status);
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

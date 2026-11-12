import { toPersistedTeam } from "../domain/team-content-codec";
import "server-only";
import { runFencedTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import type { TeamStatus } from "../domain/team";
import { DEFAULT_TEAM_VISIBILITY, type TeamVisibility } from "../domain/team-authority";
import { requireAppAdmin } from "./require-app-admin";
import { type AuthRefusal } from "../../auth/server/auth-refusal";
const COLLECTION_NAME = "teams";

/** The persisted shape of one `teams` document. */
export interface TeamRecord {
  name: string;
  status: TeamStatus;
  /** Always `private` at creation (docs/archive/features/teamadmin-and-team-visibility/SPEC.md). */
  visibility: TeamVisibility;
  createdAt: Date;
  createdBy: string;
}

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore `CollectionReference` (whose `.add()` assigns the opaque,
 * auto-generated document ID that becomes `teamId`) and by an in-memory
 * fake in tests.
 */
export interface TeamsCollection {
  add(record: TeamRecord): Promise<{ id: string }>;
}

/** Writer-only: the create (stamps the admin's uid) runs in a transaction that reads `accountErasures/{actorUid}` first (TASK-035, W-17). */
function getDefaultCollection(actorUid: string): TeamsCollection {
  return {
    async add(record) {
      const db = getFirestoreDb();
      const ref = db.collection(COLLECTION_NAME).doc();
      await runFencedTransaction(db, actorUid, async (tx) => {
        tx.create(ref, toPersistedTeam(ref.id, { ...record }));
      });
      return { id: ref.id };
    },
  };
}

export type CreateTeamResult =
  | { ok: true; teamId: string }
  | {
      ok: false;
      error: AuthRefusal | "forbidden" | "invalid_name" | "persistence_failed";
    };

export interface CreateTeamDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  collection?: TeamsCollection;
}

/**
 * Creates a new `active` team. Only an app admin may call this
 * successfully (docs/archive/features/team-management/SPEC.md — BR-1, BR-2). The
 * resulting `teamId` is Firestore's auto-generated document ID — never
 * derived from `name` (SPEC → Architecture decisions → "Team identifier
 * scheme").
 */
export async function createTeam(
  idToken: string,
  name: unknown,
  deps: CreateTeamDeps = {},
): Promise<CreateTeamResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    isSuperadmin: deps.isSuperadmin,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  if (typeof name !== "string" || name.trim().length === 0) {
    return { ok: false, error: "invalid_name" };
  }

  const record: TeamRecord = {
    name: name.trim(),
    status: "active",
    visibility: DEFAULT_TEAM_VISIBILITY,
    createdAt: deps.now ?? new Date(),
    createdBy: admin.identity.uid,
  };

  const collection = deps.collection ?? getDefaultCollection(admin.identity.uid);

  try {
    const { id } = await collection.add(record);
    return { ok: true, teamId: id };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

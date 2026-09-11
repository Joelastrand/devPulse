import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../domain/app-admin";
import type { TeamStatus } from "../domain/team";
import { requireAppAdmin } from "./require-app-admin";

const COLLECTION_NAME = "teams";

/** The persisted shape of one `teams` document. */
export interface TeamRecord {
  name: string;
  status: TeamStatus;
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

function getDefaultCollection(): TeamsCollection {
  return getFirestoreDb().collection(COLLECTION_NAME);
}

export type CreateTeamResult =
  | { ok: true; teamId: string }
  | {
      ok: false;
      error: "unauthenticated" | "forbidden" | "invalid_name" | "persistence_failed";
    };

export interface CreateTeamDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  collection?: TeamsCollection;
}

/**
 * Creates a new `active` team. Only an app admin may call this
 * successfully (docs/features/team-management/SPEC.md — BR-1, BR-2). The
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
    allowList: deps.allowList,
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
    createdAt: deps.now ?? new Date(),
    createdBy: admin.identity.uid,
  };

  const collection = deps.collection ?? getDefaultCollection();

  try {
    const { id } = await collection.add(record);
    return { ok: true, teamId: id };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { isValidTeamStatus } from "../domain/team";

const COLLECTION_NAME = "teams";

/** The minimal, public shape of one active team. */
export interface PublicTeam {
  teamId: string;
  name: string;
}

interface ActiveTeamDoc {
  id: string;
  name: unknown;
  status: unknown;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore query filtered to `status == "active"` and by an in-memory
 * fake in tests.
 */
export interface ActiveTeamsCollection {
  listActive(): Promise<ActiveTeamDoc[]>;
}

function getDefaultCollection(): ActiveTeamsCollection {
  return {
    async listActive() {
      const snapshot = await getFirestoreDb()
        .collection(COLLECTION_NAME)
        .where("status", "==", "active")
        .get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name,
        status: doc.data().status,
      }));
    },
  };
}

export type ListActiveTeamsResult =
  | { ok: true; teams: PublicTeam[] }
  | { ok: false; error: "read_failed" };

export interface ListActiveTeamsDeps {
  collection?: ActiveTeamsCollection;
}

/**
 * Public, unauthenticated read of the currently active teams — the sole
 * authoritative source for both the pulse-survey team selector (BR-31) and
 * submission-time team validation (BR-32). Exposes only `{teamId, name}`:
 * no status, membership, admin, invitation, or access-request data. A
 * malformed individual document (missing/invalid `status` or a non-string
 * or blank `name`) is excluded rather than failing the whole read; a
 * Firestore read failure fails the entire result closed rather than
 * falling back to any static list (docs/features/team-management/SPEC.md
 * — TASK-006).
 */
export async function listActiveTeams(
  deps: ListActiveTeamsDeps = {},
): Promise<ListActiveTeamsResult> {
  const collection = deps.collection ?? getDefaultCollection();

  let docs: ActiveTeamDoc[];
  try {
    docs = await collection.listActive();
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const teams: PublicTeam[] = [];
  for (const doc of docs) {
    if (!isValidTeamStatus(doc.status) || doc.status !== "active") {
      continue;
    }
    if (typeof doc.name !== "string" || doc.name.trim().length === 0) {
      continue;
    }
    teams.push({ teamId: doc.id, name: doc.name });
  }

  return { ok: true, teams };
}

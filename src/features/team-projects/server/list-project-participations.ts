import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { resolveTeamRole, type ResolveTeamRoleDeps } from "../../teams/server/resolve-team-role";
import {
  hasOverlappingParticipation,
  parseStoredParticipation,
  type TeamProjectParticipation,
} from "../domain/team-project-participation";
import { toParticipationView, type ProjectParticipationView } from "./write-project-participation";

const PARTICIPATIONS_COLLECTION = "teamProjectParticipations";

/** Upper bound of participation records read for one team. Beyond it the response is marked `truncated`. */
export const TEAM_PARTICIPATIONS_MAX = 200;

export type ListProjectParticipationsError = AuthRefusal | "forbidden" | "read_failed";

export type ListProjectParticipationsResult =
  | { ok: true; participations: ProjectParticipationView[]; canEdit: boolean; truncated: boolean }
  | { ok: false; error: ListProjectParticipationsError };

/** Raw read seam: documents of `teamId` with `participationId` added, at most `limit`. Production uses Admin SDK only. */
export interface ProjectParticipationReadStore {
  listByTeam(teamId: string, limit: number): Promise<unknown[]>;
}

export interface ListProjectParticipationsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  roleDeps?: ResolveTeamRoleDeps;
  store?: ProjectParticipationReadStore;
}

export function getDefaultProjectParticipationReadStore(): ProjectParticipationReadStore {
  return {
    async listByTeam(teamId, limit) {
      const snapshot = await getFirestoreDb()
        .collection(PARTICIPATIONS_COLLECTION)
        .where("teamId", "==", teamId)
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({ participationId: doc.id, ...doc.data() }));
    },
  };
}

/**
 * Reads the participation records of one team project (SPEC — BR-8, BR-12, BR-13). `teamId` and `projectId` come from
 * the route only. Any non-denied team role may read; only a `lead` may write (`canEdit`). Archived records are excluded
 * unless `includeArchived` is set. The overlap flag is computed over the team's active records of the same member, so a
 * filtered response still reports overlaps with records outside the requested project. A malformed stored record fails
 * the whole read (`read_failed`); it is never coerced.
 */
export async function listProjectParticipations(
  idToken: string,
  teamId: string,
  projectId: string,
  options: { includeArchived?: boolean } = {},
  deps: ListProjectParticipationsDeps = {},
): Promise<ListProjectParticipationsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };

  const role = await resolveTeamRole(verified.identity, teamId, deps.roleDeps);
  if (!role.ok) return { ok: false, error: "read_failed" };
  if (role.role === "denied") return { ok: false, error: "forbidden" };

  const store = deps.store ?? getDefaultProjectParticipationReadStore();
  let raw: unknown[];
  try {
    raw = await store.listByTeam(teamId, TEAM_PARTICIPATIONS_MAX + 1);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const truncated = raw.length > TEAM_PARTICIPATIONS_MAX;
  const parsed: TeamProjectParticipation[] = [];
  for (const entry of raw.slice(0, TEAM_PARTICIPATIONS_MAX)) {
    const participationId =
      typeof (entry as { participationId?: unknown })?.participationId === "string"
        ? (entry as { participationId: string }).participationId
        : "";
    const record = parseStoredParticipation(entry, participationId, teamId);
    if (record === null) return { ok: false, error: "read_failed" };
    parsed.push(record);
  }

  const active = parsed.filter((record) => !record.archived);
  const participations = parsed
    .filter((record) => record.projectId === projectId && (options.includeArchived === true || !record.archived))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.participationId.localeCompare(b.participationId))
    .map((record) => {
      const others = active.filter((other) => other.participationId !== record.participationId);
      return toParticipationView(record, hasOverlappingParticipation(record, others));
    });

  return { ok: true, participations, canEdit: role.canAdminister, truncated };
}

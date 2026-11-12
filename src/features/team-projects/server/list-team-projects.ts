import "server-only";
import { openTeamProjectDocument } from "./team-project-codec";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { resolveTeamRole, type ResolveTeamRoleDeps } from "../../teams/server/resolve-team-role";
import { parseStoredTeamProject, resolveEffectiveProjectStatusAt, type ProjectEffectiveStatus, type ProjectLifecycleStatus, type ProjectPriority, type TeamProject } from "../domain/team-project";

const PROJECTS_COLLECTION = "teamProjects";

/** Upper bound of projects read for one team. Beyond it the response is marked `truncated`. */
export const TEAM_PROJECTS_MAX = 200;

/** Allow-listed response shape. No actor uids, no timestamps beyond the calendar dates. */
export interface TeamProjectView {
  projectId: string;
  title: string;
  startDate: string;
  endDate: string;
  lifecycleStatus: ProjectLifecycleStatus;
  effectiveStatus: ProjectEffectiveStatus;
  priority: ProjectPriority;
  archived: boolean;
}

export type ListTeamProjectsError = AuthRefusal | "forbidden" | "read_failed";

export type ListTeamProjectsResult =
  | { ok: true; projects: TeamProjectView[]; canEdit: boolean; truncated: boolean }
  | { ok: false; error: ListTeamProjectsError };

/** Raw read seam: documents of `teamId`, timestamps mapped, at most `limit`. Production uses Admin SDK only. */
export interface TeamProjectReadStore {
  listByTeam(teamId: string, limit: number): Promise<unknown[]>;
}

export interface ListTeamProjectsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  roleDeps?: ResolveTeamRoleDeps;
  store?: TeamProjectReadStore;
  now?: () => Date;
}

export function getDefaultTeamProjectReadStore(): TeamProjectReadStore {
  return {
    async listByTeam(teamId, limit) {
      const snapshot = await getFirestoreDb()
        .collection(PROJECTS_COLLECTION)
        .where("teamId", "==", teamId)
        .limit(limit)
        .get();
      return mapTeamProjectDocs(snapshot.docs);
    },
  };
}

/**
 * Stored project documents do not carry their own `projectId`: the document id is the only identifier. The id is taken
 * from `doc.id` here, after the stored fields are spread, so the gateway's identity never depends on a stored field.
 * Without it every row fails `parseStoredTeamProject` and the whole read fails closed.
 */
export function mapTeamProjectDocs(
  docs: ReadonlyArray<{ id: string; data(): Record<string, unknown> }>,
): Record<string, unknown>[] {
  // An unopenable project contributes no title, so its row fails `parseStoredTeamProject` and the read fails closed.
  return docs.map((doc) => ({ ...(openTeamProjectDocument(doc.id, mapProjectTimestamps(doc.data())) ?? {}), projectId: doc.id }));
}

function mapProjectTimestamps(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of ["createdAt", "updatedAt", "archivedAt"]) {
    const value = out[key] as { toDate?: () => Date } | null | undefined;
    if (value && typeof value.toDate === "function") out[key] = value.toDate();
  }
  return out;
}

/**
 * Reads the projects of one team (SPEC — BR-6, BR-14). `teamId` comes from the
 * route only. Authorization is `resolveTeamRole`: any non-denied role may read;
 * only a `lead` may write (`canEdit`). Archived projects are excluded unless
 * `includeArchived` is set. Malformed stored records are not returned: the read
 * fails with `read_failed` rather than coercing them.
 */
export async function listTeamProjects(
  idToken: string,
  teamId: string,
  options: { includeArchived?: boolean } = {},
  deps: ListTeamProjectsDeps = {},
): Promise<ListTeamProjectsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };

  const role = await resolveTeamRole(verified.identity, teamId, deps.roleDeps);
  if (!role.ok) return { ok: false, error: "read_failed" };
  if (role.role === "denied") return { ok: false, error: "forbidden" };

  const store = deps.store ?? getDefaultTeamProjectReadStore();
  let raw: unknown[];
  try {
    raw = await store.listByTeam(teamId, TEAM_PROJECTS_MAX + 1);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const truncated = raw.length > TEAM_PROJECTS_MAX;
  const parsed: TeamProject[] = [];
  for (const entry of raw.slice(0, TEAM_PROJECTS_MAX)) {
    const projectId = typeof (entry as { projectId?: unknown })?.projectId === "string" ? (entry as { projectId: string }).projectId : "";
    const project = parseStoredTeamProject(entry, projectId, teamId);
    if (project === null) return { ok: false, error: "read_failed" };
    parsed.push(project);
  }

  const now = (deps.now ?? (() => new Date()))();
  const projects = parsed
    .filter((project) => options.includeArchived === true || !project.archived)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title) || a.projectId.localeCompare(b.projectId))
    .map((project) => toProjectView(project, now));

  return { ok: true, projects, canEdit: role.canAdminister, truncated };
}

export function toProjectView(project: TeamProject, now: Date): TeamProjectView {
  return {
    projectId: project.projectId,
    title: project.title,
    startDate: project.startDate,
    endDate: project.endDate,
    lifecycleStatus: project.lifecycleStatus,
    effectiveStatus: resolveEffectiveProjectStatusAt(project, now),
    priority: project.priority,
    archived: project.archived,
  };
}

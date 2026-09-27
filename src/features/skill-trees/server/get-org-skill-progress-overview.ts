import "server-only";
import { FieldPath } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { isValidTeamStatus, type TeamStatus } from "../../teams/domain/team";
import { isValidSkillTree, type SkillTreeRecord } from "../domain/skill-tree";
import { isValidSkillProgress, type SkillProgressRecord } from "../domain/skill-progress";
import {
  LIST_SKILL_TREES_LIMIT,
  type RawSkillTreeDoc,
  type SkillNodeView,
  type SkillTreesReader,
} from "./list-skill-trees";

const SKILL_PROGRESS_COLLECTION = "skillProgress";
const TEAMS_COLLECTION = "teams";

/**
 * The server-enforced bound on the `skillProgress` read this operation runs
 * (docs/features/org-skill-progress-overview/SPEC.md — BR-20). A generous,
 * explicit multiple of `LIST_SKILL_TREES_LIMIT` chosen to comfortably exceed
 * this application's actual current scale while still being a real,
 * documented bound rather than an unbounded collection scan. If more than
 * this many `skillProgress` documents exist, the *most-recently-updated*
 * ones survive truncation (BR-20/BR-21) — see the descending `orderBy`
 * below.
 */
export const LIST_ORG_SKILL_PROGRESS_LIMIT = 2000;

/** The client-facing shape of one tracking team's entry within a tree (SPEC — "API/DTO contracts"). */
export interface OrgSkillProgressTeamEntryView {
  teamId: string;
  teamName: string;
  teamStatus: TeamStatus;
  currentNodeId: string | null;
}

/** The client-facing shape of one included `SkillTree` and its tracking teams (SPEC — "API/DTO contracts"). */
export interface OrgSkillProgressTreeView {
  treeId: string;
  name: string;
  nodes: SkillNodeView[];
  teams: OrgSkillProgressTeamEntryView[];
}

export type GetOrgSkillProgressOverviewResult =
  | { ok: true; trees: OrgSkillProgressTreeView[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

/** One raw `skillProgress` document, paired with its Firestore-assigned id (never itself part of the returned DTO — BR-25). */
export interface RawSkillProgressDoc {
  id: string;
  data: unknown;
}

/**
 * The read seam for the `skillProgress` query this operation depends on,
 * satisfied in production by a Firestore query and by an in-memory fake in
 * tests. Returns every raw document the bounded, ordered query yields
 * regardless of validity — filtering/validation happens entirely in
 * `getOrgSkillProgressOverview`, never here.
 */
export interface OrgSkillProgressReader {
  listOrderedByUpdatedAtDesc(limit: number): Promise<RawSkillProgressDoc[]>;
}

/**
 * `.orderBy("updatedAt", "desc").orderBy(FieldPath.documentId(), "desc")
 * .limit(LIST_ORG_SKILL_PROGRESS_LIMIT)`, no `.where()` — the exact query
 * shape declared by SPEC.md's BR-20. The `FieldPath.documentId()` tie-break
 * is written explicitly (never left to Firestore's implicit default
 * ordering) because it is part of this operation's determinism contract,
 * independent of index requirements. Verified against Firebase's official
 * indexing documentation to require **no** user-managed composite index
 * (SPEC.md — "Firestore/index implications"): this query's `__name__`
 * ordering direction (`desc`) matches `updatedAt`'s direction, which is the
 * default `__name__` tiebreak direction every Firestore index — including
 * the automatic single-field index already maintained for `updatedAt` —
 * already applies. `firestore.indexes.json` is intentionally not touched by
 * this operation.
 */
function getDefaultOrgSkillProgressReader(): OrgSkillProgressReader {
  return {
    async listOrderedByUpdatedAtDesc(limit) {
      const snapshot = await getFirestoreDb()
        .collection(SKILL_PROGRESS_COLLECTION)
        .orderBy("updatedAt", "desc")
        .orderBy(FieldPath.documentId(), "desc")
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}

/** One raw `teams` document, paired with its Firestore-assigned id. */
export interface RawTeamDoc {
  id: string;
  data: unknown;
}

/**
 * The read seam for the unbounded `teams` read this operation depends on —
 * matches `listTeams`'s existing unbounded, admin-only "every team
 * including disabled" pattern exactly (SPEC.md — BR-20). Satisfied in
 * production by a Firestore collection read and by an in-memory fake in
 * tests.
 */
export interface OrgTeamsReader {
  listAll(): Promise<RawTeamDoc[]>;
}

function getDefaultOrgTeamsReader(): OrgTeamsReader {
  return {
    async listAll() {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}

/** Maps raw Firestore document data (Timestamp fields included) into the candidate shape `isValidSkillTree` expects. */
function toCandidateSkillTree(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  return {
    ...record,
    createdAt: toDateOrUndefined(record.createdAt),
    updatedAt: toDateOrUndefined(record.updatedAt),
  };
}

/** Maps raw Firestore document data (Timestamp fields included) into the candidate shape `isValidSkillProgress` expects. */
function toCandidateSkillProgress(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  return {
    ...record,
    updatedAt: toDateOrUndefined(record.updatedAt),
  };
}

function toDateOrUndefined(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  // Left as-is (not a Date) so the corresponding `isValidDate` check fails
  // closed on it, rather than silently coercing an unexpected shape.
  return value;
}

/** A minimally-resolved `teams` document — only what BR-9/BR-14/BR-17 need. */
interface ResolvedTeam {
  name: string;
  status: TeamStatus;
}

/**
 * Validates a raw `teams` document field-by-field using the same inline
 * `name`/`status` checks `listActiveTeams` already applies — deliberately
 * *not* a new `isValidTeam` full-record validator (SPEC.md — Architecture
 * decision 3; `.claude/rules/typescript.md` — "Avoid abstractions... without
 * a concrete current need"). Returns `undefined` (fail closed, never
 * throws) for a missing/non-object document, a `status` that fails
 * `isValidTeamStatus`, or a missing/blank `name` (BR-17).
 */
function resolveTeam(data: unknown): ResolvedTeam | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  if (!isValidTeamStatus(record.status)) {
    return undefined;
  }
  if (typeof record.name !== "string" || record.name.trim().length === 0) {
    return undefined;
  }
  return { name: record.name, status: record.status };
}

function toSkillNodeViews(tree: SkillTreeRecord): SkillNodeView[] {
  return tree.nodes.map((node) => ({ nodeId: node.nodeId, label: node.label, order: node.order }));
}

/** Case-sensitive ordinal comparison, `name` ascending then `teamId` ascending as tiebreak (BR-12). */
function compareTeamEntries(
  a: OrgSkillProgressTeamEntryView,
  b: OrgSkillProgressTeamEntryView,
): number {
  if (a.teamName !== b.teamName) {
    return a.teamName < b.teamName ? -1 : 1;
  }
  if (a.teamId === b.teamId) {
    return 0;
  }
  return a.teamId < b.teamId ? -1 : 1;
}

export interface GetOrgSkillProgressOverviewDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  treesReader?: SkillTreesReader;
  progressReader?: OrgSkillProgressReader;
  teamsReader?: OrgTeamsReader;
}

/**
 * Cross-team `SkillTree` progress overview (docs/features/
 * org-skill-progress-overview/SPEC.md — TASK-001, BR-1 through BR-26).
 * App-admin-only (`requireAppAdmin`, unchanged — BR-1); performs no
 * `authorizeTeamAccess` check of any kind (BR-2) — this operation is not
 * team-scoped. Read-only: never creates, updates, or deletes any
 * `skillTrees`, `skillProgress`, or `teams` document (BR-3).
 *
 * Runs three independent, bounded reads — this operation's own copy of the
 * `skillTrees` bounded read (not a call to `listSkillTrees`, avoiding a
 * second, redundant token verification within one request — Architecture
 * decision 4), a new bounded `skillProgress` read
 * (`orderBy("updatedAt","desc").orderBy(FieldPath.documentId(),"desc")
 * .limit(LIST_ORG_SKILL_PROGRESS_LIMIT)` — BR-20, verified to require no
 * composite index, see `getDefaultOrgSkillProgressReader`), and an
 * unbounded `teams` read (matches `listTeams`'s existing pattern) — then
 * joins them entirely in memory. Any thrown/rejected read fails the whole
 * operation closed with `read_failed`, never partial/raw data (BR-19).
 *
 * Per `skillProgress` record: `isValidSkillProgress` (skip on failure —
 * BR-15) → resolve `treeId` against the bounded, valid `skillTrees` result
 * set (a tree that doesn't resolve, including one that exists but fell
 * outside the 500-oldest bound, is skipped — BR-16) → resolve `teamId`
 * against the unbounded `teams` result set via `resolveTeam` (missing or
 * failing validation is skipped — BR-17). No check failure, nor any raw
 * field value, is ever surfaced (BR-18). A disabled team's entry is never
 * excluded by this join — only `teamStatus` reflects it (BR-13/BR-14).
 *
 * A `SkillTree` is included only once at least one valid, resolvable team
 * entry survives (BR-6/BR-7). Trees are ordered exactly as the bounded
 * `skillTrees` read already yields them (`createdAt` ascending — BR-11);
 * within a tree, teams are ordered `name` ascending with `teamId` ascending
 * as tiebreak (BR-12). Every DTO field is rebuilt explicitly — never a
 * spread of raw data — omitting `createdAt`/`createdBy`/`updatedAt`/
 * `updatedBy` from either source document (BR-23), any membership/
 * invitation/access-request or per-person field (BR-24), and the raw
 * `skillProgress` composite document id (BR-25).
 */
export async function getOrgSkillProgressOverview(
  idToken: string,
  deps: GetOrgSkillProgressOverviewDeps = {},
): Promise<GetOrgSkillProgressOverviewResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const treesReader = deps.treesReader ?? getDefaultOrgSkillTreesReader();
  const progressReader = deps.progressReader ?? getDefaultOrgSkillProgressReader();
  const teamsReader = deps.teamsReader ?? getDefaultOrgTeamsReader();

  let rawTrees: RawSkillTreeDoc[];
  let rawProgress: RawSkillProgressDoc[];
  let rawTeams: RawTeamDoc[];
  try {
    [rawTrees, rawProgress, rawTeams] = await Promise.all([
      treesReader.listOrderedByCreatedAt(LIST_SKILL_TREES_LIMIT),
      progressReader.listOrderedByUpdatedAtDesc(LIST_ORG_SKILL_PROGRESS_LIMIT),
      teamsReader.listAll(),
    ]);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const validTreesById = new Map<string, SkillTreeRecord>();
  const treeOrder: string[] = [];
  for (const { id, data } of rawTrees) {
    const candidate = toCandidateSkillTree(data);
    if (isValidSkillTree(candidate)) {
      validTreesById.set(id, candidate);
      treeOrder.push(id);
    }
  }

  const resolvedTeamsById = new Map<string, ResolvedTeam>();
  for (const { id, data } of rawTeams) {
    const resolved = resolveTeam(data);
    if (resolved) {
      resolvedTeamsById.set(id, resolved);
    }
  }

  const teamEntriesByTreeId = new Map<string, OrgSkillProgressTeamEntryView[]>();
  for (const { data } of rawProgress) {
    const progressCandidate = toCandidateSkillProgress(data);
    if (!isValidSkillProgress(progressCandidate)) {
      continue;
    }
    const progress: SkillProgressRecord = progressCandidate;

    if (!validTreesById.has(progress.treeId)) {
      continue;
    }
    const team = resolvedTeamsById.get(progress.teamId);
    if (!team) {
      continue;
    }

    const entries = teamEntriesByTreeId.get(progress.treeId) ?? [];
    entries.push({
      teamId: progress.teamId,
      teamName: team.name,
      teamStatus: team.status,
      currentNodeId: progress.currentNodeId,
    });
    teamEntriesByTreeId.set(progress.treeId, entries);
  }

  const trees: OrgSkillProgressTreeView[] = [];
  for (const treeId of treeOrder) {
    const entries = teamEntriesByTreeId.get(treeId);
    if (!entries || entries.length === 0) {
      continue;
    }
    const tree = validTreesById.get(treeId);
    if (!tree) {
      continue;
    }

    entries.sort(compareTeamEntries);
    trees.push({
      treeId,
      name: tree.name,
      nodes: toSkillNodeViews(tree),
      teams: entries,
    });
  }

  return { ok: true, trees };
}

/**
 * This operation's own copy of `listSkillTrees`'s bounded, ordered read
 * (`orderBy("createdAt","asc").limit(LIST_SKILL_TREES_LIMIT)`) — reused
 * query shape, not reused call (Architecture decision 4). Single-field
 * `orderBy`, no `.where()` — auto-indexed, unchanged conclusion from
 * docs/features/team-skill-tree/SPEC.md.
 */
function getDefaultOrgSkillTreesReader(): SkillTreesReader {
  return {
    async listOrderedByCreatedAt(limit) {
      const snapshot = await getFirestoreDb()
        .collection("skillTrees")
        .orderBy("createdAt", "asc")
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}

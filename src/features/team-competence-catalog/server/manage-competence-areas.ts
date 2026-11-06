import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { verifyIdToken, type VerifyIdTokenDeps, type VerifiedIdentity } from "../../auth/server/verify-identity";
import { isValidSkillTree, type SkillTreeRecord } from "../../skill-trees/domain/skill-tree";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isAppAdmin, type IsAppAdminDeps } from "../../teams/domain/app-admin";
import { canAdministerTeam } from "../../teams/domain/team-authority";
import { membershipDocId } from "../../teams/domain/team-membership";
import { resolveTeamRole, type ResolveTeamRoleDeps } from "../../teams/server/resolve-team-role";
import {
  COMPETENCE_AREAS_PER_TEAM_MAX,
  competenceAreaDocId,
  isValidCompetenceArea,
  parseAssignCompetenceAreaBody,
  parseCompetenceAreaOrderBody,
  parseCompetenceAreaStatusBody,
  transitionCompetenceAreaStatus,
  type CompetenceAreaRecord,
  type CompetenceAreaStatus,
} from "../domain/competence-area";

const COMPETENCE_AREAS_COLLECTION = "teamCompetenceAreas";
const SKILL_TREES_COLLECTION = "skillTrees";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * Team-readable view of one assignment. `name` comes from the admin-owned catalog and is `null` when the catalog entry is
 * missing or invalid (shown as unavailable, never guessed). No rating, level, count or member data.
 */
export interface CompetenceAreaView {
  treeId: string;
  name: string | null;
  status: CompetenceAreaStatus;
  sortOrder: number;
}

export type CompetenceAreaError =
  | AuthRefusal
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "skill_unavailable"
  | "not_found"
  | "already_assigned"
  | "area_archived"
  | "limit_reached"
  | "order_mismatch"
  | "read_failed"
  | "persistence_failed";

/** Raw document with its Firestore id and unvalidated data (dates mapped to `Date`). */
export interface RawAreaDoc {
  id: string;
  data: unknown;
}

/** Transaction seam. Every read happens before the first write. */
export interface CompetenceAreaWriteTx {
  getTeamStatus(teamId: string): Promise<unknown>;
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getSkillTree(treeId: string): Promise<unknown>;
  listAreas(teamId: string, limit: number): Promise<RawAreaDoc[]>;
  getArea(docId: string): Promise<unknown>;
  putArea(docId: string, record: CompetenceAreaRecord): void;
}

export interface CompetenceAreaWriteStore {
  runTransaction<T>(fn: (tx: CompetenceAreaWriteTx) => Promise<T>): Promise<T>;
}

/** Read seam for the team's own assignments. No write method exists. */
export interface CompetenceAreaReadStore {
  listByTeam(teamId: string, limit: number): Promise<RawAreaDoc[]>;
}

/** Read seam for the admin-owned catalog. No write method exists. */
export interface CompetenceCatalogReader {
  /** Raw `skillTrees/{treeId}` data with dates mapped, or `undefined` if absent. */
  getSkillTree(treeId: string): Promise<unknown>;
}

export interface CompetenceAreaDeps {
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  roleDeps?: ResolveTeamRoleDeps;
  catalog?: CompetenceCatalogReader;
  readStore?: CompetenceAreaReadStore;
  writeStore?: CompetenceAreaWriteStore;
  now?: () => Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDate(value: unknown): unknown {
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return value;
}

function mapDates(data: unknown, fields: readonly string[]): unknown {
  if (!isPlainObject(data)) return data;
  const out: Record<string, unknown> = { ...data };
  for (const field of fields) {
    if (field in out) out[field] = toDate(out[field]);
  }
  return out;
}

/**
 * A catalog entry as a candidate for `isValidSkillTree`, with its timestamps mapped. Fails closed: a value that cannot
 * be mapped stays as-is and is rejected by the validator.
 */
function candidateTree(raw: unknown): unknown {
  return mapDates(raw, ["createdAt", "updatedAt"]);
}

function validTree(raw: unknown): SkillTreeRecord | null {
  const candidate = candidateTree(raw);
  return isValidSkillTree(candidate) ? candidate : null;
}

/** Catalog name of a tree, or `null` when the catalog entry is missing or invalid. */
function nameOf(raw: unknown): string | null {
  return validTree(raw)?.name ?? null;
}

function toView(record: CompetenceAreaRecord, name: string | null): CompetenceAreaView {
  return { treeId: record.treeId, name, status: record.status, sortOrder: record.sortOrder };
}

function getDefaultReadStore(): CompetenceAreaReadStore {
  return {
    async listByTeam(teamId, limit) {
      const snapshot = await getFirestoreDb()
        .collection(COMPETENCE_AREAS_COLLECTION)
        .where("teamId", "==", teamId)
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: mapDates(doc.data(), ["createdAt", "updatedAt"]) }));
    },
  };
}

function getDefaultCatalogReader(): CompetenceCatalogReader {
  return {
    async getSkillTree(treeId) {
      const snapshot = await getFirestoreDb().collection(SKILL_TREES_COLLECTION).doc(treeId).get();
      return snapshot.exists ? mapDates(snapshot.data(), ["createdAt", "updatedAt"]) : undefined;
    },
  };
}

function toFirestoreTx(db: Firestore, tx: Transaction): CompetenceAreaWriteTx {
  const areas = () => db.collection(COMPETENCE_AREAS_COLLECTION);
  return {
    async getTeamStatus(teamId) {
      const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async getMembership(uid, teamId) {
      const snapshot = await tx.get(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)));
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getSkillTree(treeId) {
      const snapshot = await tx.get(db.collection(SKILL_TREES_COLLECTION).doc(treeId));
      return snapshot.exists ? mapDates(snapshot.data(), ["createdAt", "updatedAt"]) : undefined;
    },
    async listAreas(teamId, limit) {
      const snapshot = await tx.get(areas().where("teamId", "==", teamId).limit(limit));
      return snapshot.docs.map((doc) => ({ id: doc.id, data: mapDates(doc.data(), ["createdAt", "updatedAt"]) }));
    },
    async getArea(docId) {
      const snapshot = await tx.get(areas().doc(docId));
      return snapshot.exists ? mapDates(snapshot.data(), ["createdAt", "updatedAt"]) : undefined;
    },
    putArea(docId, record) {
      tx.set(areas().doc(docId), record);
    },
  };
}

function getDefaultWriteStore(): CompetenceAreaWriteStore {
  return {
    runTransaction(fn) {
      const db = getFirestoreDb();
      return db.runTransaction((tx) => fn(toFirestoreTx(db, tx)));
    },
  };
}

/** Parses every raw assignment of one team. Any invalid document fails the whole set (fail closed, never repaired). */
function parseTeamAreas(raw: RawAreaDoc[], teamId: string): CompetenceAreaRecord[] | null {
  const records: CompetenceAreaRecord[] = [];
  for (const { id, data } of raw) {
    if (!isValidCompetenceArea(data, { docId: id }) || data.teamId !== teamId) return null;
    records.push(data);
  }
  return records;
}

/**
 * Lead decision inside the write transaction (SPEC — BR-18). Order: the caller holds a membership of this team with role
 * exactly `lead` (otherwise `forbidden`), then the team is `active` (otherwise `team_disabled`). App-admin status is never
 * consulted. A malformed membership is treated as no membership.
 */
async function gateLead(
  identity: VerifiedIdentity,
  teamId: string,
  tx: CompetenceAreaWriteTx,
  isSuperadmin: IsAppAdminDeps["isSuperadmin"],
): Promise<{ ok: true } | { ok: false; error: CompetenceAreaError }> {
  const membership = await tx.getMembership(identity.uid, teamId);
  if (!canAdministerTeam({ isSuperadmin: await isAppAdmin(identity, { isSuperadmin }), uid: identity.uid, teamId, membership })) {
    return { ok: false, error: "forbidden" };
  }
  const status = await tx.getTeamStatus(teamId);
  if (!isValidTeamStatus(status) || status !== "active") return { ok: false, error: "team_disabled" };
  return { ok: true };
}

export type ListCompetenceAreasResult =
  | { ok: true; areas: CompetenceAreaView[]; canEdit: boolean; truncated: boolean }
  | { ok: false; error: CompetenceAreaError };

/**
 * Team's assignments in order (SPEC — BR-18). Any non-denied team role may read, as for team projects; only a `lead` may
 * edit (`canEdit`). Archived assignments are excluded unless `includeArchived` is set. Names come from the admin catalog.
 * A malformed stored assignment fails the read rather than being skipped.
 */
export async function listCompetenceAreas(
  idToken: string,
  teamId: string,
  options: { includeArchived?: boolean } = {},
  deps: CompetenceAreaDeps = {},
): Promise<ListCompetenceAreasResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };

  const role = await resolveTeamRole(verified.identity, teamId, deps.roleDeps);
  if (!role.ok) return { ok: false, error: "read_failed" };
  if (role.role === "denied") return { ok: false, error: "forbidden" };

  const readStore = deps.readStore ?? getDefaultReadStore();
  const catalog = deps.catalog ?? getDefaultCatalogReader();
  let raw: RawAreaDoc[];
  try {
    raw = await readStore.listByTeam(teamId, COMPETENCE_AREAS_PER_TEAM_MAX + 1);
  } catch {
    return { ok: false, error: "read_failed" };
  }
  const truncated = raw.length > COMPETENCE_AREAS_PER_TEAM_MAX;
  const records = parseTeamAreas(raw.slice(0, COMPETENCE_AREAS_PER_TEAM_MAX), teamId);
  if (records === null) return { ok: false, error: "read_failed" };

  const ordered = records
    .filter((record) => options.includeArchived === true || record.status !== "archived")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.treeId.localeCompare(b.treeId));
  const areas: CompetenceAreaView[] = [];
  for (const record of ordered) {
    let name: string | null;
    try {
      name = nameOf(await catalog.getSkillTree(record.treeId));
    } catch {
      return { ok: false, error: "read_failed" };
    }
    areas.push(toView(record, name));
  }

  return { ok: true, areas, canEdit: role.canAdminister, truncated };
}

export type CompetenceAreaWriteResult = { ok: true; area: CompetenceAreaView } | { ok: false; error: CompetenceAreaError };

/**
 * Assigns one catalog area to the team (SPEC — BR-18). Lead of an active team only. The area must exist and be valid in
 * the catalog. Re-assigning an active or inactive area is `already_assigned`; an archived one is `area_archived` (archive
 * is terminal). New assignments go last in the team's order.
 */
export async function assignCompetenceArea(
  idToken: string,
  teamId: string,
  body: unknown,
  deps: CompetenceAreaDeps = {},
): Promise<CompetenceAreaWriteResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const now = (deps.now ?? (() => new Date()))();
  const store = deps.writeStore ?? getDefaultWriteStore();

  try {
    return await store.runTransaction(async (tx): Promise<CompetenceAreaWriteResult> => {
      const lead = await gateLead(verified.identity, teamId, tx, deps.isSuperadmin);
      if (!lead.ok) return lead;

      const input = parseAssignCompetenceAreaBody(body);
      if (!input.ok) return input;
      const { treeId } = input.value;

      const rawTree = await tx.getSkillTree(treeId);
      if (validTree(rawTree) === null) return { ok: false, error: "skill_unavailable" };
      const docId = competenceAreaDocId(teamId, treeId);

      const rawExisting = await tx.getArea(docId);
      if (rawExisting !== undefined) {
        if (!isValidCompetenceArea(rawExisting, { docId }) || rawExisting.teamId !== teamId) {
          return { ok: false, error: "persistence_failed" };
        }
        return { ok: false, error: rawExisting.status === "archived" ? "area_archived" : "already_assigned" };
      }

      const current = parseTeamAreas(await tx.listAreas(teamId, COMPETENCE_AREAS_PER_TEAM_MAX + 1), teamId);
      if (current === null) return { ok: false, error: "persistence_failed" };
      if (current.length >= COMPETENCE_AREAS_PER_TEAM_MAX) return { ok: false, error: "limit_reached" };

      const sortOrder = current.reduce((max, record) => Math.max(max, record.sortOrder + 1), 0);
      const record: CompetenceAreaRecord = { teamId, treeId, status: "active", sortOrder, createdAt: now, updatedAt: now };
      tx.putArea(docId, record);
      return { ok: true, area: toView(record, nameOf(rawTree)) };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/**
 * Sets one assignment to `active`, `inactive` or `archived` (SPEC — BR-18). Lead of an active team only. Archive keeps the
 * document and its order slot; an archived assignment cannot change. Ratings are never read or written here.
 */
export async function setCompetenceAreaStatus(
  idToken: string,
  teamId: string,
  treeId: string,
  body: unknown,
  deps: CompetenceAreaDeps = {},
): Promise<CompetenceAreaWriteResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const now = (deps.now ?? (() => new Date()))();
  const store = deps.writeStore ?? getDefaultWriteStore();

  try {
    return await store.runTransaction(async (tx): Promise<CompetenceAreaWriteResult> => {
      const lead = await gateLead(verified.identity, teamId, tx, deps.isSuperadmin);
      if (!lead.ok) return lead;

      const input = parseCompetenceAreaStatusBody(body);
      if (!input.ok) return input;

      const docId = competenceAreaDocId(teamId, treeId);
      const rawExisting = await tx.getArea(docId);
      if (rawExisting === undefined) return { ok: false, error: "not_found" };
      if (!isValidCompetenceArea(rawExisting, { docId }) || rawExisting.teamId !== teamId) {
        return { ok: false, error: "persistence_failed" };
      }
      const existing: CompetenceAreaRecord = rawExisting;
      const transition = transitionCompetenceAreaStatus(existing.status, input.value.status);
      if (!transition.ok) return { ok: false, error: transition.error };

      const rawTree = await tx.getSkillTree(treeId);
      if (!transition.changed) return { ok: true, area: toView(existing, nameOf(rawTree)) };

      const next: CompetenceAreaRecord = { ...existing, status: input.value.status, updatedAt: now };
      tx.putArea(docId, next);
      return { ok: true, area: toView(next, nameOf(rawTree)) };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

export type ReorderCompetenceAreasResult = { ok: true; order: string[] } | { ok: false; error: CompetenceAreaError };

/**
 * Replaces the team's order of its non-archived assignments (SPEC — BR-18). The request must name exactly those
 * assignments, each once. Archived assignments keep their slot and are never reordered. Lead of an active team only.
 */
export async function reorderCompetenceAreas(
  idToken: string,
  teamId: string,
  body: unknown,
  deps: CompetenceAreaDeps = {},
): Promise<ReorderCompetenceAreasResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const now = (deps.now ?? (() => new Date()))();
  const store = deps.writeStore ?? getDefaultWriteStore();

  try {
    return await store.runTransaction(async (tx): Promise<ReorderCompetenceAreasResult> => {
      const lead = await gateLead(verified.identity, teamId, tx, deps.isSuperadmin);
      if (!lead.ok) return lead;

      const input = parseCompetenceAreaOrderBody(body);
      if (!input.ok) return input;

      const current = parseTeamAreas(await tx.listAreas(teamId, COMPETENCE_AREAS_PER_TEAM_MAX + 1), teamId);
      if (current === null) return { ok: false, error: "persistence_failed" };

      const movable = current
        .filter((record) => record.status !== "archived")
        .sort((a, b) => a.sortOrder - b.sortOrder || a.treeId.localeCompare(b.treeId));
      const movableIds = new Set(movable.map((record) => record.treeId));
      const requested = input.value.order;
      if (requested.length !== movable.length || !requested.every((treeId) => movableIds.has(treeId))) {
        return { ok: false, error: "order_mismatch" };
      }

      requested.forEach((treeId, index) => {
        const record = movable.find((candidate) => candidate.treeId === treeId);
        if (record !== undefined && record.sortOrder !== index) {
          tx.putArea(competenceAreaDocId(teamId, treeId), { ...record, sortOrder: index, updatedAt: now });
        }
      });
      return { ok: true, order: requested };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

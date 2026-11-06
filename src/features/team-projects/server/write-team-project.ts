import "server-only";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { runFencedTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isAppAdmin, type IsAppAdminDeps } from "../../teams/domain/app-admin";
import { canAdministerTeam } from "../../teams/domain/team-authority";
import { membershipDocId } from "../../teams/domain/team-membership";
import {
  parseStoredTeamProject,
  validateProjectFields,
  type ProjectFields,
  type ProjectValidationIssue,
  type TeamProject,
} from "../domain/team-project";
import { toProjectView, type TeamProjectView } from "./list-team-projects";

const PROJECTS_COLLECTION = "teamProjects";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const TEAMS_COLLECTION = "teams";

/**
 * Allow-listed write keys. `productId` is deliberately absent: no product entity
 * exists yet, so a same-team product reference cannot be validated (see
 * VERIFICATION.md, TASK-003 — blocked on a product-entity decision).
 */
const UPDATE_KEYS = ["title", "startDate", "endDate", "lifecycleStatus", "priority"] as const;
// Erasure: teamProjects is allow-listed as non-person-owned (inventory-allow-list.ts). No actor field may be added here
// without a registry row in inventory.ts.
const CREATE_KEYS = UPDATE_KEYS;

export type WriteTeamProjectError =
  | AuthRefusal
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "not_found"
  | "project_archived"
  | "erasure_in_progress"
  | "persistence_failed";

export type WriteTeamProjectResult =
  | { ok: true; project: TeamProjectView }
  | { ok: false; error: "invalid_input"; issues: ProjectValidationIssue[] }
  | { ok: false; error: Exclude<WriteTeamProjectError, "invalid_input"> };

export type WriteTeamProjectAction = "create" | "update" | "archive" | "restore";

/**
 * Transaction seam. Every read happens before the single write. Raw, unvalidated
 * data (timestamps already mapped to `Date`).
 */
export interface WriteTeamProjectTx {
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getTeamStatus(teamId: string): Promise<unknown>;
  getProject(projectId: string): Promise<unknown>;
  createProject(projectId: string, data: Record<string, unknown>): void;
  setProject(projectId: string, data: Record<string, unknown>): void;
}

export interface WriteTeamProjectStore {
  /** Writer-only: the erasure fence is read first, in the same transaction. */
  runWriteTransaction<T>(actorUid: string, fn: (tx: WriteTeamProjectTx) => Promise<T>): Promise<T>;
}

function toFirestoreTx(db: Firestore, tx: Transaction): WriteTeamProjectTx {
  const projects = () => db.collection(PROJECTS_COLLECTION);
  return {
    async getMembership(uid, teamId) {
      const snapshot = await tx.get(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)));
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getTeamStatus(teamId) {
      const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async getProject(projectId) {
      const snapshot = await tx.get(projects().doc(projectId));
      if (!snapshot.exists) return undefined;
      const data = { ...snapshot.data() } as Record<string, unknown>;
      for (const key of ["createdAt", "updatedAt", "archivedAt"]) {
        const value = data[key] as { toDate?: () => Date } | null | undefined;
        if (value && typeof value.toDate === "function") data[key] = value.toDate();
      }
      return { projectId, ...data };
    },
    createProject(projectId, data) {
      tx.create(projects().doc(projectId), data);
    },
    setProject(projectId, data) {
      tx.set(projects().doc(projectId), data);
    },
  };
}

function getDefaultStore(): WriteTeamProjectStore {
  return {
    runWriteTransaction(actorUid, fn) {
      const db = getFirestoreDb();
      return runFencedTransaction(db, actorUid, (tx) => fn(toFirestoreTx(db, tx)));
    },
  };
}

export interface WriteTeamProjectDeps {
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: WriteTeamProjectStore;
  now?: () => Date;
  newProjectId?: () => string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict allow-list envelope check. Field validity is checked later against the merged result. */
function parseEnvelope(body: unknown, keys: readonly string[]): Record<string, unknown> | "invalid_request" {
  if (!isPlainObject(body)) return "invalid_request";
  if (Object.keys(body).some((key) => !keys.includes(key))) return "invalid_request";
  return body;
}

/** Stored fields the caller may change, merged over the existing project. */
function mergeFields(existing: TeamProject, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    title: "title" in patch ? patch.title : existing.title,
    startDate: "startDate" in patch ? patch.startDate : existing.startDate,
    endDate: "endDate" in patch ? patch.endDate : existing.endDate,
    lifecycleStatus: "lifecycleStatus" in patch ? patch.lifecycleStatus : existing.lifecycleStatus,
    priority: "priority" in patch ? patch.priority : existing.priority,
  };
}

function toStoredData(
  teamId: string,
  fields: ProjectFields,
  archived: boolean,
  archivedAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
): Record<string, unknown> {
  return {
    teamId,
    title: fields.title,
    startDate: fields.startDate,
    endDate: fields.endDate,
    lifecycleStatus: fields.lifecycleStatus,
    priority: fields.priority,
    archived,
    archivedAt,
    createdAt,
    updatedAt,
  };
}

/**
 * Creates, updates, archives or restores one team project (SPEC — BR-6, BR-7).
 * `teamId` comes from the route only. Writes require a `lead` membership of the
 * caller on an `active` team, re-read inside the transaction. An app admin who
 * is not a lead cannot write. Projects are never deleted.
 *
 * No actor uid is stored. `teamProjects` is allow-listed as non-person-owned in
 * `account-erasure/server/inventory-allow-list.ts`; adding an actor field would require a registry row first.
 */
export async function writeTeamProject(
  idToken: string,
  teamId: string,
  action: WriteTeamProjectAction,
  projectId: string | null,
  body: unknown,
  deps: WriteTeamProjectDeps = {},
): Promise<WriteTeamProjectResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const uid = verified.identity.uid;
  const isSuperadmin = await isAppAdmin(verified.identity, { isSuperadmin: deps.isSuperadmin });

  let patch: Record<string, unknown> = {};
  if (action === "create" || action === "update") {
    const envelope = parseEnvelope(body, action === "create" ? CREATE_KEYS : UPDATE_KEYS);
    if (envelope === "invalid_request") return { ok: false, error: "invalid_request" };
    patch = envelope;
  } else if (body !== undefined && body !== null && !(isPlainObject(body) && Object.keys(body).length === 0)) {
    return { ok: false, error: "invalid_request" };
  }

  if ((action === "create") !== (projectId === null)) return { ok: false, error: "invalid_request" };

  const now = (deps.now ?? (() => new Date()))();
  const targetId = projectId ?? (deps.newProjectId ?? randomUUID)();
  const store = deps.store ?? getDefaultStore();

  let outcome: WriteTeamProjectResult;
  try {
    outcome = await store.runWriteTransaction(uid, async (tx): Promise<WriteTeamProjectResult> => {
      const fail = (error: Exclude<WriteTeamProjectError, "invalid_input">): WriteTeamProjectResult => ({ ok: false, error });

      const membership = await tx.getMembership(uid, teamId);
      if (!canAdministerTeam({ isSuperadmin, uid, teamId, membership })) {
        return fail("forbidden");
      }
      const teamStatus = await tx.getTeamStatus(teamId);
      if (!isValidTeamStatus(teamStatus) || teamStatus !== "active") return fail("team_disabled");

      if (action === "create") {
        const checked = validateProjectFields({ ...patch });
        if (!checked.ok) return { ok: false, error: "invalid_input", issues: checked.issues };
        tx.createProject(targetId, toStoredData(teamId, checked.value, false, null, now, now));
        return { ok: true, project: toProjectView({ projectId: targetId, teamId, ...checked.value, archived: false }, now) };
      }

      const raw = await tx.getProject(targetId);
      if (raw === undefined || (isPlainObject(raw) && raw.teamId !== teamId)) return fail("not_found");
      const existing = parseStoredTeamProject(raw, targetId, teamId);
      if (existing === null) return fail("persistence_failed");
      const createdAt = isPlainObject(raw) ? asDate(raw.createdAt, now) : now;

      if (action === "update") {
        if (existing.archived) return fail("project_archived");
        const checked = validateProjectFields(mergeFields(existing, patch));
        if (!checked.ok) return { ok: false, error: "invalid_input", issues: checked.issues };
        const next: TeamProject = { ...existing, ...checked.value, archived: false };
        tx.setProject(targetId, toStoredData(teamId, checked.value, false, null, createdAt, now));
        return { ok: true, project: toProjectView(next, now) };
      }

      // Lifecycle: archive/restore keep every field; only the archive flag and its timestamp change.
      const archived = action === "archive";
      const next: TeamProject = { ...existing, archived };
      const fields: ProjectFields = {
        title: existing.title,
        startDate: existing.startDate,
        endDate: existing.endDate,
        lifecycleStatus: existing.lifecycleStatus,
        priority: existing.priority,
      };
      tx.setProject(targetId, toStoredData(teamId, fields, archived, archived ? now : null, createdAt, now));
      return { ok: true, project: toProjectView(next, now) };
    });
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }

  return outcome;
}

function asDate(value: unknown, fallback: Date): Date {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : fallback;
}

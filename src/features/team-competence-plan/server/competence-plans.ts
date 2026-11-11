import "server-only";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { verifyIdToken, type VerifiedIdentity, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isAppAdmin, type IsAppAdminDeps } from "../../teams/domain/app-admin";
import { canAdministerTeam } from "../../teams/domain/team-authority";
import { membershipDocId } from "../../teams/domain/team-membership";
import { resolveTeamRole, type ResolveTeamRoleDeps } from "../../teams/server/resolve-team-role";
import {
  isWellFormedPlanId,
  parseStoredCompetencePlan,
  planProgress,
  resolveMilestones,
  validatePlanInput,
  type CompetencePlan,
  type PlanInputIssue,
  type PlanMilestone,
  type PlanProgress,
} from "../domain/competence-plan";
import type { SelfAssessedLevel } from "../../skill-profiles/domain/self-assessed-level";
import type { RoadmapPriority } from "../../roadmap/domain/roadmap-item";

const PLANS_COLLECTION = "teamCompetencePlans";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** Upper bound of plans per team (archived included). A repository choice. */
export const COMPETENCE_PLANS_PER_TEAM_MAX = 100;

/** Team-readable view. Plan content and progress only: no uid, actor, rating or member data. */
export interface CompetencePlanView {
  planId: string;
  title: string;
  treeId: string | null;
  targetStage: SelfAssessedLevel;
  priority: RoadmapPriority;
  archived: boolean;
  milestones: PlanMilestone[];
  progress: PlanProgress;
}

export type CompetencePlanError =
  | AuthRefusal
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "not_found"
  | "limit_reached"
  | "read_failed"
  | "persistence_failed";

export type CompetencePlanInputIssue = PlanInputIssue;

export interface RawPlanDoc {
  id: string;
  data: unknown;
}

/** Transaction seam. Every read happens before the single write. Raw, unvalidated data (dates mapped to `Date`). */
export interface CompetencePlanWriteTx {
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getTeamStatus(teamId: string): Promise<unknown>;
  getPlan(planId: string): Promise<unknown>;
  putPlan(planId: string, record: CompetencePlan): void;
}

export interface CompetencePlanWriteStore {
  runTransaction<T>(fn: (tx: CompetencePlanWriteTx) => Promise<T>): Promise<T>;
}

export interface CompetencePlanReadStore {
  listByTeam(teamId: string, limit: number): Promise<RawPlanDoc[]>;
}

export interface CompetencePlanDeps {
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  roleDeps?: ResolveTeamRoleDeps;
  readStore?: CompetencePlanReadStore;
  writeStore?: CompetencePlanWriteStore;
  now?: () => Date;
  newId?: () => string;
}

function mapDates(data: unknown, fields: readonly string[]): unknown {
  if (typeof data !== "object" || data === null) return data;
  const copy: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const field of fields) {
    const value = copy[field];
    if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
      copy[field] = (value as { toDate: () => Date }).toDate();
    }
  }
  return copy;
}

function toView(planId: string, plan: CompetencePlan): CompetencePlanView {
  return {
    planId,
    title: plan.title,
    treeId: plan.treeId,
    targetStage: plan.targetStage,
    priority: plan.priority,
    archived: plan.archived,
    milestones: plan.milestones,
    progress: planProgress(plan.milestones),
  };
}

function getDefaultReadStore(): CompetencePlanReadStore {
  return {
    async listByTeam(teamId, limit) {
      const snapshot = await getFirestoreDb()
        .collection(PLANS_COLLECTION)
        .where("teamId", "==", teamId)
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: mapDates(doc.data(), ["createdAt", "updatedAt"]) }));
    },
  };
}

function toFirestoreTx(db: Firestore, tx: Transaction): CompetencePlanWriteTx {
  const plans = () => db.collection(PLANS_COLLECTION);
  return {
    async getMembership(uid, teamId) {
      const snapshot = await tx.get(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)));
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getTeamStatus(teamId) {
      const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async getPlan(planId) {
      const snapshot = await tx.get(plans().doc(planId));
      return snapshot.exists ? mapDates(snapshot.data(), ["createdAt", "updatedAt"]) : undefined;
    },
    putPlan(planId, record) {
      tx.set(plans().doc(planId), record);
    },
  };
}

function getDefaultWriteStore(): CompetencePlanWriteStore {
  return {
    runTransaction(fn) {
      const db = getFirestoreDb();
      return db.runTransaction((tx) => fn(toFirestoreTx(db, tx)));
    },
  };
}

/**
 * Team-administration decision inside the write transaction (SPEC — BR-15; teamadmin/superadmin model). A superadmin or a
 * genuine `teamadmin` of an active team only. A malformed membership counts as no membership.
 */
async function gateLead(
  identity: VerifiedIdentity,
  teamId: string,
  tx: CompetencePlanWriteTx,
  isSuperadmin: IsAppAdminDeps["isSuperadmin"],
): Promise<{ ok: true } | { ok: false; error: CompetencePlanError }> {
  const membership = await tx.getMembership(identity.uid, teamId);
  if (!canAdministerTeam({ isSuperadmin: await isAppAdmin(identity, { isSuperadmin }), uid: identity.uid, teamId, membership })) {
    return { ok: false, error: "forbidden" };
  }
  const status = await tx.getTeamStatus(teamId);
  if (!isValidTeamStatus(status) || status !== "active") return { ok: false, error: "team_disabled" };
  return { ok: true };
}

export type ListCompetencePlansResult =
  | { ok: true; plans: CompetencePlanView[]; canEdit: boolean; truncated: boolean }
  | { ok: false; error: CompetencePlanError };

/**
 * The team's competence plans (SPEC — BR-15, BR-16). Any non-denied team role may read; only a lead may edit (`canEdit`).
 * Archived plans are excluded unless `includeArchived` is set. A malformed stored plan fails the read, never skipped.
 */
export async function listCompetencePlans(
  idToken: string,
  teamId: string,
  options: { includeArchived?: boolean } = {},
  deps: CompetencePlanDeps = {},
): Promise<ListCompetencePlansResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };

  const role = await resolveTeamRole(verified.identity, teamId, deps.roleDeps);
  if (!role.ok) return { ok: false, error: "read_failed" };
  if (role.role === "denied") return { ok: false, error: "forbidden" };

  const readStore = deps.readStore ?? getDefaultReadStore();
  let raw: RawPlanDoc[];
  try {
    raw = await readStore.listByTeam(teamId, COMPETENCE_PLANS_PER_TEAM_MAX + 1);
  } catch {
    return { ok: false, error: "read_failed" };
  }
  const truncated = raw.length > COMPETENCE_PLANS_PER_TEAM_MAX;
  const plans: { planId: string; plan: CompetencePlan }[] = [];
  for (const { id, data } of raw.slice(0, COMPETENCE_PLANS_PER_TEAM_MAX)) {
    const plan = parseStoredCompetencePlan(data, { docId: id });
    if (plan === null || plan.teamId !== teamId) return { ok: false, error: "read_failed" };
    plans.push({ planId: id, plan });
  }

  const visible = plans
    .filter(({ plan }) => options.includeArchived === true || !plan.archived)
    .sort((a, b) => a.plan.title.localeCompare(b.plan.title, "nb"))
    .map(({ planId, plan }) => toView(planId, plan));
  return { ok: true, plans: visible, canEdit: role.canAdminister, truncated };
}

export type CompetencePlanWriteResult =
  | { ok: true; plan: CompetencePlanView }
  | { ok: false; error: CompetencePlanError; issues?: CompetencePlanInputIssue[] };

/**
 * Creates a plan (SPEC — BR-15, OD-6). Lead of an active team only. A plan needs no competence area, catalog entry, rating or
 * consent: the body is the plan's own content, and the document id is a fresh server-issued UUID. `treeId` is always `null`.
 */
export async function createCompetencePlan(
  idToken: string,
  teamId: string,
  body: unknown,
  deps: CompetencePlanDeps = {},
): Promise<CompetencePlanWriteResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const now = (deps.now ?? (() => new Date()))();
  const newId = deps.newId ?? randomUUID;
  const store = deps.writeStore ?? getDefaultWriteStore();

  const input = validatePlanInput(body);
  if (!input.ok) return { ok: false, error: "invalid_input", issues: input.issues };

  try {
    return await store.runTransaction(async (tx): Promise<CompetencePlanWriteResult> => {
      const lead = await gateLead(verified.identity, teamId, tx, deps.isSuperadmin);
      if (!lead.ok) return lead;

      const planId = newId();
      if (!isWellFormedPlanId(planId)) return { ok: false, error: "persistence_failed" };
      const resolved = resolveMilestones(input.value.milestones, [], newId);
      if (!resolved.ok) return { ok: false, error: "invalid_input", issues: ["milestone_id_invalid"] };

      const record: CompetencePlan = {
        teamId,
        title: input.value.title,
        treeId: null,
        targetStage: input.value.targetStage,
        priority: input.value.priority,
        archived: input.value.archived,
        milestones: resolved.milestones,
        createdAt: now,
        updatedAt: now,
      };
      tx.putPlan(planId, record);
      return { ok: true, plan: toView(planId, record) };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/**
 * Replaces the editable fields of one existing plan (SPEC — BR-15, BR-17). Lead of an active team only. A plan id that is
 * unknown, or stored for another team, is `not_found`. Existing milestone ids are kept; an unknown id is refused. The stored
 * `treeId` label and creation time are preserved. The target stage is a goal and is never copied from a rating.
 */
export async function updateCompetencePlan(
  idToken: string,
  teamId: string,
  planId: string,
  body: unknown,
  deps: CompetencePlanDeps = {},
): Promise<CompetencePlanWriteResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  if (!isWellFormedPlanId(planId)) return { ok: false, error: "invalid_input" };
  const now = (deps.now ?? (() => new Date()))();
  const newId = deps.newId ?? randomUUID;
  const store = deps.writeStore ?? getDefaultWriteStore();

  const input = validatePlanInput(body);
  if (!input.ok) return { ok: false, error: "invalid_input", issues: input.issues };

  try {
    return await store.runTransaction(async (tx): Promise<CompetencePlanWriteResult> => {
      const lead = await gateLead(verified.identity, teamId, tx, deps.isSuperadmin);
      if (!lead.ok) return lead;

      const rawExisting = await tx.getPlan(planId);
      if (rawExisting === undefined) return { ok: false, error: "not_found" };
      const existing = parseStoredCompetencePlan(rawExisting, { docId: planId });
      if (existing === null) return { ok: false, error: "persistence_failed" };
      if (existing.teamId !== teamId) return { ok: false, error: "not_found" };

      const resolved = resolveMilestones(input.value.milestones, existing.milestones, newId);
      if (!resolved.ok) return { ok: false, error: "invalid_input", issues: ["milestone_id_invalid"] };

      const record: CompetencePlan = {
        teamId,
        title: input.value.title,
        treeId: existing.treeId,
        targetStage: input.value.targetStage,
        priority: input.value.priority,
        archived: input.value.archived,
        milestones: resolved.milestones,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      tx.putPlan(planId, record);
      return { ok: true, plan: toView(planId, record) };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

import "server-only";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { runFencedTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isMemberRef, resolveMemberRef } from "../../teams/domain/member-ref";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isAppAdmin, type IsAppAdminDeps } from "../../teams/domain/app-admin";
import { canAdministerTeam } from "../../teams/domain/team-authority";
import { extractMemberUid, membershipDocId } from "../../teams/domain/team-membership";
import { parseStoredTeamProject } from "../domain/team-project";
import {
  hasOverlappingParticipation,
  parseStoredParticipation,
  validateParticipationFields,
  type ParticipationValidationIssue,
  type TeamProjectParticipation,
} from "../domain/team-project-participation";

const PARTICIPATIONS_COLLECTION = "teamProjectParticipations";
const PROJECTS_COLLECTION = "teamProjects";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const TEAMS_COLLECTION = "teams";

/** Upper bound of one member's participation records read for the overlap check. Beyond it the write is refused. */
export const MEMBER_PARTICIPATIONS_MAX = 200;

/** Allow-listed write keys. `projectId` comes from the route; `memberRef` is fixed after creation (remove and recreate to change it). */
const CREATE_KEYS = ["memberRef", "startDate", "endDate", "note"] as const;
const UPDATE_KEYS = ["startDate", "endDate", "note"] as const;

/** Allow-listed response shape. No uid, no e-mail, no timestamps, no utilization or capacity values. */
export interface ProjectParticipationView {
  participationId: string;
  projectId: string;
  memberRef: string;
  startDate: string;
  endDate: string;
  note: string | null;
  archived: boolean;
  /** Informational only (BR-8): true when another active participation of the same member overlaps this interval. */
  overlapsOther: boolean;
}

export type WriteProjectParticipationError =
  | AuthRefusal
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "not_found"
  | "project_archived"
  | "participation_archived"
  | "invalid_member"
  | "limit_reached"
  | "erasure_in_progress"
  | "persistence_failed";

export type WriteProjectParticipationResult =
  | { ok: true; participation: ProjectParticipationView }
  | { ok: false; error: "invalid_input"; issues: ParticipationValidationIssue[] }
  | { ok: false; error: Exclude<WriteProjectParticipationError, "invalid_input"> };

export type WriteProjectParticipationAction = "create" | "update" | "remove";

/**
 * Reads and the single write available inside one write transaction. Every read happens before the write
 * (Firestore transaction rule). Raw, unvalidated data.
 */
export interface WriteProjectParticipationTx {
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getTeamStatus(teamId: string): Promise<unknown>;
  /** Raw project document with `projectId` added, or `undefined`. */
  getProject(projectId: string): Promise<unknown>;
  /** Raw participation document with `participationId` added, or `undefined`. */
  getParticipation(participationId: string): Promise<unknown>;
  /** Memberships of `teamId` whose `memberRef` is in `refs`. */
  listMembershipsByRefs(teamId: string, refs: readonly string[]): Promise<unknown[]>;
  /** Every participation record of one member in the team, raw with `participationId`, at most `limit`. */
  listParticipationsOfMember(teamId: string, memberRef: string, limit: number): Promise<unknown[]>;
  createParticipation(participationId: string, data: Record<string, unknown>): void;
  setParticipation(participationId: string, data: Record<string, unknown>): void;
  /**
   * Transactional coordination with membership erasure (roadmap convention, A-5): writes the target membership with its
   * unchanged `memberRef`, so a concurrent erasure that read it conflicts with this write.
   */
  touchMembership(uid: string, teamId: string, memberRef: string): void;
}

export interface WriteProjectParticipationStore {
  /** Writer-only: the erasure fence is read first, in the same transaction. */
  runWriteTransaction<T>(actorUid: string, fn: (tx: WriteProjectParticipationTx) => Promise<T>): Promise<T>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idOf(raw: unknown, key: "participationId" | "projectId"): string {
  return isPlainObject(raw) && typeof raw[key] === "string" ? (raw[key] as string) : "";
}

function toFirestoreTx(db: Firestore, tx: Transaction): WriteProjectParticipationTx {
  const participations = () => db.collection(PARTICIPATIONS_COLLECTION);
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
      const snapshot = await tx.get(db.collection(PROJECTS_COLLECTION).doc(projectId));
      return snapshot.exists ? { projectId, ...snapshot.data() } : undefined;
    },
    async getParticipation(participationId) {
      const snapshot = await tx.get(participations().doc(participationId));
      return snapshot.exists ? { participationId, ...snapshot.data() } : undefined;
    },
    async listMembershipsByRefs(teamId, refs) {
      if (refs.length === 0) return [];
      const snapshot = await tx.get(
        db.collection(MEMBERSHIPS_COLLECTION).where("teamId", "==", teamId).where("memberRef", "in", [...refs]),
      );
      return snapshot.docs.map((doc) => doc.data());
    },
    async listParticipationsOfMember(teamId, memberRef, limit) {
      const snapshot = await tx.get(
        participations().where("teamId", "==", teamId).where("memberRef", "==", memberRef).limit(limit),
      );
      return snapshot.docs.map((doc) => ({ participationId: doc.id, ...doc.data() }));
    },
    createParticipation(participationId, data) {
      tx.create(participations().doc(participationId), data);
    },
    setParticipation(participationId, data) {
      tx.set(participations().doc(participationId), data);
    },
    touchMembership(uid, teamId, memberRef) {
      tx.update(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)), { memberRef });
    },
  };
}

function getDefaultStore(): WriteProjectParticipationStore {
  return {
    runWriteTransaction(actorUid, fn) {
      const db = getFirestoreDb();
      return runFencedTransaction(db, actorUid, (tx) => fn(toFirestoreTx(db, tx)));
    },
  };
}

export interface WriteProjectParticipationDeps {
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: WriteProjectParticipationStore;
  newParticipationId?: () => string;
}

/** Strict allow-list envelope check. Field validity is checked later against the merged result. */
function parseEnvelope(body: unknown, keys: readonly string[]): Record<string, unknown> | "invalid_request" {
  if (!isPlainObject(body)) return "invalid_request";
  if (Object.keys(body).some((key) => !keys.includes(key))) return "invalid_request";
  return body;
}

function toStored(
  teamId: string,
  fields: { projectId: string; memberRef: string; startDate: string; endDate: string; note?: string },
  archived: boolean,
): Record<string, unknown> {
  return {
    teamId,
    projectId: fields.projectId,
    memberRef: fields.memberRef,
    startDate: fields.startDate,
    endDate: fields.endDate,
    ...(fields.note !== undefined ? { note: fields.note } : {}),
    archived,
  };
}

export function toParticipationView(record: TeamProjectParticipation, overlapsOther: boolean): ProjectParticipationView {
  return {
    participationId: record.participationId,
    projectId: record.projectId,
    memberRef: record.memberRef,
    startDate: record.startDate,
    endDate: record.endDate,
    note: record.note ?? null,
    archived: record.archived,
    overlapsOther: record.archived ? false : overlapsOther,
  };
}

/**
 * Creates, updates or removes (archives) one project participation record (SPEC — BR-8, BR-12, BR-13). `teamId` and
 * `projectId` come from the route only. Writes require a `lead` membership of the caller on an `active` team, re-read
 * inside the transaction. The member must hold a current membership of the same team; a removed member is refused as
 * `invalid_member`. Archived projects accept no new or changed participation. Removal is a soft archive and is allowed
 * on an archived project so that cleanup stays possible. No actor uid is stored.
 */
export async function writeProjectParticipation(
  idToken: string,
  teamId: string,
  projectId: string,
  action: WriteProjectParticipationAction,
  participationId: string | null,
  body: unknown,
  deps: WriteProjectParticipationDeps = {},
): Promise<WriteProjectParticipationResult> {
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

  if ((action === "create") !== (participationId === null)) return { ok: false, error: "invalid_request" };

  const targetId = participationId ?? (deps.newParticipationId ?? randomUUID)();
  const store = deps.store ?? getDefaultStore();

  let outcome: WriteProjectParticipationResult;
  try {
    outcome = await store.runWriteTransaction(uid, async (tx): Promise<WriteProjectParticipationResult> => {
      const fail = (error: WriteProjectParticipationError): WriteProjectParticipationResult => ({ ok: false, error });

      const membership = await tx.getMembership(uid, teamId);
      if (!canAdministerTeam({ isSuperadmin, uid, teamId, membership })) {
        return fail("forbidden");
      }
      const teamStatus = await tx.getTeamStatus(teamId);
      if (!isValidTeamStatus(teamStatus) || teamStatus !== "active") return fail("team_disabled");

      // The existing record, read first for update and remove. A record of another team or another project is not found.
      let existing: TeamProjectParticipation | null = null;
      if (participationId !== null) {
        const raw = await tx.getParticipation(targetId);
        if (raw === undefined || (isPlainObject(raw) && raw.teamId !== teamId)) return fail("not_found");
        existing = parseStoredParticipation(raw, targetId, teamId);
        if (existing === null) return fail("persistence_failed");
        if (existing.projectId !== projectId) return fail("not_found");
      }

      // Field validation, against the merged result for update.
      let fields: { projectId: string; memberRef: string; startDate: string; endDate: string; note?: string } | null = null;
      if (action !== "remove") {
        const merged =
          action === "create"
            ? { projectId, ...patch }
            : {
                projectId,
                memberRef: existing?.memberRef,
                startDate: "startDate" in patch ? patch.startDate : existing?.startDate,
                endDate: "endDate" in patch ? patch.endDate : existing?.endDate,
                note: "note" in patch ? patch.note : existing?.note,
              };
        const checked = validateParticipationFields(merged);
        if (!checked.ok) return { ok: false, error: "invalid_input", issues: checked.issues };
        fields = checked.value;
      }

      if (action === "update" && existing?.archived) return fail("participation_archived");

      if (action !== "remove") {
        const rawProject = await tx.getProject(projectId);
        if (rawProject === undefined || (isPlainObject(rawProject) && rawProject.teamId !== teamId)) return fail("not_found");
        const project = parseStoredTeamProject(rawProject, projectId, teamId);
        if (project === null) return fail("persistence_failed");
        if (project.archived) return fail("project_archived");
      }

      const memberRef = fields?.memberRef ?? existing?.memberRef;
      if (!isMemberRef(memberRef)) return fail("persistence_failed");

      // The member must be a current member of this team. Removal of a participation does not need one, but the
      // membership is still touched when it exists, so a concurrent erasure of that member conflicts with this write.
      const memberships = await tx.listMembershipsByRefs(teamId, [memberRef]);
      const memberRecord = resolveMemberRef(memberships, teamId, memberRef);
      const memberUid = memberRecord === null ? null : extractMemberUid(memberRecord);
      if (action !== "remove" && (memberRecord === null || memberUid === null)) return fail("invalid_member");

      const others = await tx.listParticipationsOfMember(teamId, memberRef, MEMBER_PARTICIPATIONS_MAX + 1);
      if (others.length > MEMBER_PARTICIPATIONS_MAX) return fail("limit_reached");
      const activeOthers: TeamProjectParticipation[] = [];
      for (const raw of others) {
        const otherId = idOf(raw, "participationId");
        const other = parseStoredParticipation(raw, otherId, teamId);
        if (other === null) return fail("persistence_failed");
        if (otherId !== targetId && !other.archived) activeOthers.push(other);
      }

      if (action === "remove") {
        if (existing === null) return fail("not_found");
        if (existing.archived) return { ok: true, participation: toParticipationView(existing, false) };
        const archived: TeamProjectParticipation = { ...existing, archived: true };
        tx.setParticipation(targetId, toStored(teamId, archived, true));
        if (memberRecord !== null && memberUid !== null) tx.touchMembership(memberUid, teamId, memberRef);
        return { ok: true, participation: toParticipationView(archived, false) };
      }

      if (fields === null || memberUid === null) return fail("persistence_failed");
      const record: TeamProjectParticipation = {
        participationId: targetId,
        teamId,
        ...fields,
        archived: false,
      };
      const overlapsOther = hasOverlappingParticipation(fields, activeOthers);
      if (action === "create") {
        tx.createParticipation(targetId, toStored(teamId, fields, false));
      } else {
        tx.setParticipation(targetId, toStored(teamId, fields, false));
      }
      tx.touchMembership(memberUid, teamId, fields.memberRef);
      return { ok: true, participation: toParticipationView(record, overlapsOther) };
    });
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }

  return outcome;
}

import "server-only";
import { openTeamSystemDocument, toPersistedTeamSystem } from "./team-system-codec";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { type AuthRefusal, authRefusalFor } from "../../auth/server/auth-refusal";
import { runFencedTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { isMemberRef, memberRefOf, resolveMemberRef } from "../../teams/domain/member-ref";
import { isValidTeamStatus } from "../../teams/domain/team";
import { extractMemberUid, isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import {
  ASSESSMENT_ATTRIBUTES,
  TEAM_SYSTEM_LIMITS,
  chunkMemberRefs,
  isAssessmentValue,
  parseBackstageUrl,
  parseOptionalText,
  parseSystemName,
  type AssessmentAttribute,
  type AssessmentValue,
} from "../domain/team-system";
import {
  parseTeamSystemRecord,
  traceAssessment,
  type StoredAssessment,
  type StoredAssessments,
} from "../domain/team-system-record";
import { mapTeamSystemDates } from "./list-team-systems";

const SYSTEMS_COLLECTION = "teamSystems";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const TEAMS_COLLECTION = "teams";

const ALLOWED_KEYS = ["name", "description", "backstageUrl", "assessments", "knowledgeMemberRefs"];

const DEFAULT_ASSESSMENT: StoredAssessment = { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null };

export type WriteTeamSystemError =
  | AuthRefusal
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "invalid_knowledge"
  | "not_found"
  | "limit_reached"
  | "erasure_in_progress"
  | "persistence_failed";

export type WriteTeamSystemResult = { ok: true; systemId: string } | { ok: false; error: WriteTeamSystemError };

/**
 * Reads and writes available inside one write transaction. Every read happens
 * before the single write (Firestore transaction rule). Raw, unvalidated data.
 */
export interface WriteTeamSystemTx {
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getTeamStatus(teamId: string): Promise<unknown>;
  /** Memberships of `teamId` whose `memberRef` is in `refs` (at most MEMBER_REF_LOOKUP_CHUNK_SIZE). */
  listMembershipsByRefs(teamId: string, refs: readonly string[]): Promise<unknown[]>;
  /** Number of systems the team already has, read up to `limit`. */
  countSystems(teamId: string, limit: number): Promise<number>;
  /** Raw stored system document with Timestamps mapped to Dates, or `undefined`. */
  getSystem(systemId: string): Promise<unknown>;
  createSystem(systemId: string, data: Record<string, unknown>): void;
  setSystem(systemId: string, data: Record<string, unknown>): void;
  /**
   * Transactional coordination with membership erasure (roadmap convention, A-5): writes the target membership with its
   * unchanged `memberRef`, so a concurrent erasure that read it conflicts with this write.
   */
  touchMembership(uid: string, teamId: string, memberRef: string): void;
}

export interface WriteTeamSystemStore {
  /** Writer-only: the erasure fence is read first, in the same transaction (roadmap convention). */
  runWriteTransaction<T>(actorUid: string, fn: (tx: WriteTeamSystemTx) => Promise<T>): Promise<T>;
}

function getDefaultStore(): WriteTeamSystemStore {
  return {
    runWriteTransaction(actorUid, fn) {
      const db = getFirestoreDb();
      return runFencedTransaction(db, actorUid, (tx) => fn(toFirestoreTx(db, tx)));
    },
  };
}

function toFirestoreTx(db: Firestore, tx: Transaction): WriteTeamSystemTx {
  const systems = () => db.collection(SYSTEMS_COLLECTION);
  return {
    async getMembership(uid, teamId) {
      const snapshot = await tx.get(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)));
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getTeamStatus(teamId) {
      const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
    async listMembershipsByRefs(teamId, refs) {
      if (refs.length === 0) return [];
      const snapshot = await tx.get(
        db.collection(MEMBERSHIPS_COLLECTION).where("teamId", "==", teamId).where("memberRef", "in", [...refs]),
      );
      return snapshot.docs.map((doc) => doc.data());
    },
    async countSystems(teamId, limit) {
      const snapshot = await tx.get(systems().where("teamId", "==", teamId).limit(limit));
      return snapshot.size;
    },
    async getSystem(systemId) {
      const snapshot = await tx.get(systems().doc(systemId));
      return snapshot.exists ? openTeamSystemDocument(systemId, mapTeamSystemDates(snapshot.data())) : undefined;
    },
    createSystem(systemId, data) {
      tx.create(systems().doc(systemId), toPersistedTeamSystem(systemId, data));
    },
    setSystem(systemId, data) {
      tx.set(systems().doc(systemId), toPersistedTeamSystem(systemId, data));
    },
    touchMembership(uid, teamId, memberRef) {
      tx.update(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)), { memberRef });
    },
  };
}

export interface WriteTeamSystemDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: WriteTeamSystemStore;
  now?: () => Date;
  newSystemId?: () => string;
}

/** Parsed write request. Absent keys mean "leave unchanged" on update and "default" on create. */
export interface ParsedTeamSystemInput {
  name?: string;
  description?: string | null;
  backstageUrl?: string | null;
  assessments?: Partial<Record<AssessmentAttribute, { value: AssessmentValue; note: string | null }>>;
  knowledgeMemberRefs?: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strict allow-list parse (SPEC — BR-4, BR-5, BR-8). `invalid_request` for an
 * unknown key or a wrong envelope; `invalid_input` for a bad field value.
 */
export function parseTeamSystemInput(
  body: unknown,
  mode: "create" | "update",
): ParsedTeamSystemInput | "invalid_request" | "invalid_input" {
  if (!isPlainObject(body)) return "invalid_request";
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.includes(key))) return "invalid_request";

  const out: ParsedTeamSystemInput = {};

  if (body.name !== undefined || mode === "create") {
    const name = parseSystemName(body.name);
    if (name === null) return "invalid_input";
    out.name = name;
  }

  if ("description" in body) {
    const description = parseOptionalText(body.description, TEAM_SYSTEM_LIMITS.descriptionMax);
    if (description === undefined) return "invalid_input";
    out.description = description;
  }

  if ("backstageUrl" in body) {
    const url = parseBackstageUrl(body.backstageUrl);
    if (!url.ok) return "invalid_input";
    out.backstageUrl = url.value;
  }

  if ("assessments" in body) {
    if (!isPlainObject(body.assessments)) return "invalid_input";
    const assessments: NonNullable<ParsedTeamSystemInput["assessments"]> = {};
    for (const [key, raw] of Object.entries(body.assessments)) {
      if (!(ASSESSMENT_ATTRIBUTES as readonly string[]).includes(key)) return "invalid_input";
      if (!isPlainObject(raw) || !isAssessmentValue(raw.value)) return "invalid_input";
      const note = parseOptionalText(raw.note, TEAM_SYSTEM_LIMITS.noteMax);
      if (note === undefined) return "invalid_input";
      assessments[key as AssessmentAttribute] = { value: raw.value, note };
    }
    out.assessments = assessments;
  }

  if ("knowledgeMemberRefs" in body) {
    const refs = body.knowledgeMemberRefs;
    if (!Array.isArray(refs) || refs.length > TEAM_SYSTEM_LIMITS.knowledgeMembersMax) return "invalid_input";
    if (!refs.every(isMemberRef)) return "invalid_input";
    if (new Set(refs).size !== refs.length) return "invalid_input";
    out.knowledgeMemberRefs = [...refs];
  }

  return out;
}

/**
 * Creates (`systemId` absent) or updates one team system (SPEC — BR-4, BR-5,
 * BR-6, BR-7). `teamId` comes from the route only. Authorization: a genuine
 * membership of the caller on an `active` team, re-read inside the transaction.
 * An app admin who is not a member cannot write (SPEC — Actors and access).
 */
export async function writeTeamSystem(
  idToken: string,
  teamId: string,
  systemId: string | null,
  body: unknown,
  deps: WriteTeamSystemDeps = {},
): Promise<WriteTeamSystemResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: authRefusalFor(verified) };
  }
  const uid = verified.identity.uid;

  const parsed = parseTeamSystemInput(body, systemId === null ? "create" : "update");
  if (parsed === "invalid_request" || parsed === "invalid_input") {
    return { ok: false, error: parsed };
  }

  const now = (deps.now ?? (() => new Date()))();
  const targetId = systemId ?? (deps.newSystemId ?? randomUUID)();
  const store = deps.store ?? getDefaultStore();

  let outcome: WriteTeamSystemResult;
  try {
    outcome = await store.runWriteTransaction(uid, async (tx): Promise<WriteTeamSystemResult> => {
      const fail = (error: WriteTeamSystemError): WriteTeamSystemResult => ({ ok: false, error });

      const membership = await tx.getMembership(uid, teamId);
      if (!isValidMembershipFor(membership, { uid, teamId })) return fail("forbidden");
      const teamStatus = await tx.getTeamStatus(teamId);
      if (!isValidTeamStatus(teamStatus) || teamStatus !== "active") return fail("team_disabled");

      const existingRaw = systemId === null ? undefined : await tx.getSystem(targetId);
      let existing: ReturnType<typeof parseTeamSystemRecord> = null;
      if (systemId !== null) {
        if (existingRaw === undefined) return fail("not_found");
        if (isPlainObject(existingRaw) && existingRaw.teamId !== teamId) return fail("not_found");
        existing = parseTeamSystemRecord(existingRaw, targetId, teamId);
        if (existing === null) return fail("persistence_failed");
      } else {
        const count = await tx.countSystems(teamId, TEAM_SYSTEM_LIMITS.systemsPerTeamMax);
        if (count >= TEAM_SYSTEM_LIMITS.systemsPerTeamMax) return fail("limit_reached");
      }

      const previousRefs = new Set(existing?.knowledgeMemberRefs ?? []);
      const knowledgeRefs = parsed.knowledgeMemberRefs ?? existing?.knowledgeMemberRefs ?? [];

      // Only refs supplied by this write are looked up (at most 50, in chunks): no team-wide scan, no truncation.
      const memberships: unknown[] = [];
      for (const chunk of chunkMemberRefs(parsed.knowledgeMemberRefs ?? [])) {
        memberships.push(...(await tx.listMembershipsByRefs(teamId, chunk)));
      }
      const touches: { uid: string; memberRef: string }[] = [];
      for (const ref of knowledgeRefs) {
        const membershipRecord = resolveMemberRef(memberships, teamId, ref);
        const memberUid = membershipRecord === null ? null : extractMemberUid(membershipRecord);
        if (membershipRecord === null || memberUid === null || memberRefOf(membershipRecord) !== ref) {
          if (parsed.knowledgeMemberRefs !== undefined) return fail("invalid_knowledge");
          continue;
        }
        if (!previousRefs.has(ref)) touches.push({ uid: memberUid, memberRef: ref });
      }

      // Partial update (BR-5/BR-6): attributes absent from the request keep their stored value and metadata.
      const assessments = {} as StoredAssessments;
      for (const attribute of ASSESSMENT_ATTRIBUTES) {
        const previous = existing?.assessments[attribute] ?? DEFAULT_ASSESSMENT;
        const next = parsed.assessments?.[attribute];
        assessments[attribute] = next === undefined ? { ...previous } : traceAssessment(previous, next, now, uid);
      }

      const data: Record<string, unknown> = {
        teamId,
        name: parsed.name ?? existing?.name,
        description: parsed.description !== undefined ? parsed.description : (existing?.description ?? null),
        backstageUrl: parsed.backstageUrl !== undefined ? parsed.backstageUrl : (existing?.backstageUrl ?? null),
        ...Object.fromEntries(ASSESSMENT_ATTRIBUTES.map((attribute) => [attribute, toStorage(assessments[attribute])])),
        knowledgeMemberRefs: knowledgeRefs,
        createdAt: existing?.createdAt ?? now,
        // A creator erased by account erasure stays null (A-13). It is never replaced by the editing member.
        createdBy: existing === null ? uid : existing.createdBy,
        updatedAt: now,
        updatedBy: uid,
      };

      for (const touch of touches) tx.touchMembership(touch.uid, teamId, touch.memberRef);
      if (systemId === null) {
        tx.createSystem(targetId, data);
      } else {
        tx.setSystem(targetId, data);
      }
      return { ok: true, systemId: targetId };
    });
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }

  return outcome;
}

function toStorage(assessment: StoredAssessment): Record<string, unknown> {
  return {
    value: assessment.value,
    note: assessment.note,
    assessedAt: assessment.assessedAt,
    assessedBy: assessment.assessedBy,
  };
}

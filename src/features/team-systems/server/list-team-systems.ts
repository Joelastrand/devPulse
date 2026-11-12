import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { type AuthRefusal, authRefusalFor } from "../../auth/server/auth-refusal";
import { getDisplayNames, type ProfileBatchReader } from "../../profiles/server/get-display-names";
import { resolveMemberRef, memberRefOf } from "../../teams/domain/member-ref";
import { isValidTeamStatus } from "../../teams/domain/team";
import { extractMemberUid, isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "../../teams/server/authorize-team-access";
import {
  ASSESSMENT_ATTRIBUTES,
  TEAM_SYSTEM_LIMITS,
  chunkMemberRefs,
  knowledgeRiskBand,
  needsAttention,
  type AssessmentAttribute,
  type KnowledgeRiskBand,
} from "../domain/team-system";
import { parseTeamSystemRecord, type StoredAssessment, type TeamSystemRecord } from "../domain/team-system-record";
import { openTeamSystemDocument } from "./team-system-codec";

const SYSTEMS_COLLECTION = "teamSystems";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const TEAMS_COLLECTION = "teams";

export interface KnowledgeMemberView {
  memberRef: string;
  displayName: string | null;
  isSelf: boolean;
}

export interface AssessmentView {
  value: StoredAssessment["value"];
  note: string | null;
  assessedAt: string | null;
}

/**
 * Per-system read contract (SPEC — BR-3). Built field by field from the parsed
 * record; no uid, e-mail, membership document id or audit uid can appear here.
 */
export interface TeamSystemView {
  systemId: string;
  name: string;
  description: string | null;
  backstageUrl: string | null;
  assessments: Record<AssessmentAttribute, AssessmentView>;
  knowledge: KnowledgeMemberView[];
  knowledgeRisk: KnowledgeRiskBand;
  attention: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ListTeamSystemsResult =
  | { ok: true; systems: TeamSystemView[]; canEdit: boolean; truncated: boolean }
  | { ok: false; error: AuthRefusal | "forbidden" | "read_failed" };

export interface RawDoc {
  id: string;
  data: unknown;
}

/** Read seam: Firestore in production, in-memory fakes in tests. No write method exists. */
export interface TeamSystemsReadStore {
  listSystems(teamId: string, limit: number): Promise<RawDoc[]>;
  /** Memberships of `teamId` whose `memberRef` is one of `refs` (at most MEMBER_REF_LOOKUP_CHUNK_SIZE). Never a team-wide scan. */
  listMembershipsByRefs(teamId: string, refs: readonly string[]): Promise<unknown[]>;
  getMembership(uid: string, teamId: string): Promise<unknown>;
  getTeamStatus(teamId: string): Promise<unknown>;
}

const DATE_FIELDS = ["createdAt", "updatedAt"];

function toDate(value: unknown): unknown {
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return value;
}

/** Converts Firestore Timestamps to Dates inside a stored document, so the domain parser sees plain values. */
export function mapTeamSystemDates(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const field of DATE_FIELDS) {
    if (field in out) out[field] = toDate(out[field]);
  }
  for (const attribute of ASSESSMENT_ATTRIBUTES) {
    const assessment = out[attribute];
    if (typeof assessment === "object" && assessment !== null) {
      out[attribute] = { ...(assessment as Record<string, unknown>), assessedAt: toDate((assessment as Record<string, unknown>).assessedAt) };
    }
  }
  return out;
}

export function getDefaultTeamSystemsReadStore(): TeamSystemsReadStore {
  const db = () => getFirestoreDb();
  return {
    async listSystems(teamId, limit) {
      const snapshot = await db().collection(SYSTEMS_COLLECTION).where("teamId", "==", teamId).limit(limit).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: openTeamSystemDocument(doc.id, mapTeamSystemDates(doc.data())) }));
    },
    async listMembershipsByRefs(teamId, refs) {
      if (refs.length === 0) return [];
      const snapshot = await db()
        .collection(MEMBERSHIPS_COLLECTION)
        .where("teamId", "==", teamId)
        .where("memberRef", "in", [...refs])
        .get();
      return snapshot.docs.map((doc) => doc.data());
    },
    async getMembership(uid, teamId) {
      const snapshot = await db().collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(uid, teamId)).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getTeamStatus(teamId) {
      const snapshot = await db().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

export interface ListTeamSystemsDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: AuthorizeTeamAccessDeps["isSuperadmin"];
  collection?: AuthorizeTeamAccessDeps["collection"];
  store?: TeamSystemsReadStore;
  profileReader?: ProfileBatchReader;
}

/** Fresh write right (SPEC — Actors and access): genuine membership AND an `active` team. Any failure ⇒ `false`. */
async function resolveCanEdit(store: TeamSystemsReadStore, uid: string, teamId: string): Promise<boolean> {
  try {
    const membership = await store.getMembership(uid, teamId);
    if (!isValidMembershipFor(membership, { uid, teamId })) return false;
    const status = await store.getTeamStatus(teamId);
    return isValidTeamStatus(status) && status === "active";
  } catch {
    return false;
  }
}

/**
 * Read-only list of a team's systems (SPEC — BR-2, BR-3, BR-9, BR-10). The
 * caller must be `member` or `admin` per `authorizeTeamAccess`. Invalid stored
 * documents are skipped. Knowledge refs that do not resolve to a current
 * membership of this team are omitted from both the view and the risk band.
 */
export async function listTeamSystems(
  idToken: string,
  teamId: string,
  deps: ListTeamSystemsDeps = {},
): Promise<ListTeamSystemsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: authRefusalFor(verified) };
  }
  const callerUid = verified.identity.uid;

  const authorized = await authorizeTeamAccess(verified.identity, teamId, {
    isSuperadmin: deps.isSuperadmin,
    collection: deps.collection,
  });
  if (!authorized.ok) return { ok: false, error: "read_failed" };
  if (authorized.access === "denied") return { ok: false, error: "forbidden" };

  const store = deps.store ?? getDefaultTeamSystemsReadStore();
  const limit = TEAM_SYSTEM_LIMITS.systemsPerTeamMax;

  try {
    const raw = await store.listSystems(teamId, limit + 1);
    const truncated = raw.length > limit;
    const records: TeamSystemRecord[] = [];
    for (const { id, data } of raw.slice(0, limit)) {
      const record = parseTeamSystemRecord(data, id, teamId);
      if (record !== null) records.push(record);
    }

    // Every distinct ref of the loaded systems is looked up (no team-wide scan, no truncation).
    const memberships = await lookupMembershipsByRefs(
      store,
      teamId,
      [...new Set(records.flatMap((record) => record.knowledgeMemberRefs))],
    );
    const names = await getDisplayNames(
      [...new Set(records.flatMap((record) => knowledgeUids(record, memberships, teamId)))],
      { reader: deps.profileReader },
    );

    const systems = records.map((record) => toTeamSystemView(record, memberships, teamId, callerUid, names));
    systems.sort((a, b) => a.name.localeCompare(b.name, "nb"));

    const canEdit = await resolveCanEdit(store, callerUid, teamId);
    return { ok: true, systems, canEdit, truncated };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

/** Chunked ref lookups; the union of results is complete for every requested ref. */
async function lookupMembershipsByRefs(
  store: Pick<TeamSystemsReadStore, "listMembershipsByRefs">,
  teamId: string,
  refs: readonly string[],
): Promise<unknown[]> {
  const found: unknown[] = [];
  for (const chunk of chunkMemberRefs(refs)) {
    found.push(...(await store.listMembershipsByRefs(teamId, chunk)));
  }
  return found;
}

/** Resolvable knowledge member uids of one record (refs not resolving to exactly one current membership are dropped). */
function knowledgeUids(record: TeamSystemRecord, memberships: readonly unknown[], teamId: string): string[] {
  return resolveKnowledge(record, memberships, teamId).map((entry) => entry.uid);
}

function resolveKnowledge(
  record: TeamSystemRecord,
  memberships: readonly unknown[],
  teamId: string,
): { memberRef: string; uid: string }[] {
  const resolved: { memberRef: string; uid: string }[] = [];
  for (const ref of record.knowledgeMemberRefs) {
    const membership = resolveMemberRef(memberships, teamId, ref);
    const uid = membership === null ? null : extractMemberUid(membership);
    if (uid !== null && memberRefOf(membership) === ref) {
      resolved.push({ memberRef: ref, uid });
    }
  }
  return resolved;
}

/** Pure view construction (no reads), exported for unit tests. */
export function toTeamSystemView(
  record: TeamSystemRecord,
  memberships: readonly unknown[],
  teamId: string,
  callerUid: string,
  names: ReadonlyMap<string, string>,
): TeamSystemView {
  const knowledge = resolveKnowledge(record, memberships, teamId).map(
    (entry): KnowledgeMemberView => ({
      memberRef: entry.memberRef,
      displayName: names.get(entry.uid) ?? null,
      isSelf: entry.uid === callerUid,
    }),
  );

  const assessments = {} as Record<AssessmentAttribute, AssessmentView>;
  for (const attribute of ASSESSMENT_ATTRIBUTES) {
    const stored = record.assessments[attribute];
    assessments[attribute] = {
      value: stored.value,
      note: stored.note,
      assessedAt: stored.assessedAt?.toISOString() ?? null,
    };
  }

  return {
    systemId: record.systemId,
    name: record.name,
    description: record.description,
    backstageUrl: record.backstageUrl,
    assessments,
    knowledge,
    knowledgeRisk: knowledgeRiskBand(knowledge.length),
    attention: needsAttention(record.assessments),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

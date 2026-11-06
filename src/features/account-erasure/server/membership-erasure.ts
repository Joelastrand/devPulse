import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";

/**
 * The `memberships` erasure step (TASK-016; SPEC BR-10, D2, I-9, A-5). Pure logic over an injected port.
 *
 * For each of the erased person's `teamMemberships` documents, one transaction:
 *   1. nulls every `roadmapItems.ownerRef` in that team that equals this membership's opaque `memberRef`, in bounded
 *      chunks (a membership is not deleted while any such owner reference remains);
 *   2. removes this `memberRef` from every `teamSystems.knowledgeMemberRefs` entry in that team (A-14, DETACH). The system
 *      record and the other members stay; the membership is not deleted while any such entry remains; then
 *   3. deletes the membership document (this ends the membership, the lead role, and the team skill contribution it
 *      carries; those fields are removed with the document, so this step never names them).
 *
 * `roadmapItems.ownerRef` holds a `memberRef`, not a uid (A-5), so the step matches by the membership's own `memberRef`
 * and its team, never by uid. A legacy membership without a `memberRef` field cannot be the target of an owner reference,
 * so it is deleted directly. A membership without a `uid` field is found by its `uid__` document-id prefix (legacy).
 *
 * The step reports `"done"` only when no membership of the uid is left. Each batch handles one membership or a bounded
 * chunk of its owner references, so a retry after an interruption re-reads current data and is safe.
 */

export interface MembershipRaw {
  readonly id: string;
  readonly data: unknown;
}

/** A system that names a membership `memberRef` in its knowledge list (A-14). Only the id and the ref list are read. */
export interface KnowledgeSystem {
  readonly systemId: string;
  readonly knowledgeMemberRefs: readonly string[];
}

/** The ref list without the erased membership's ref. Other members keep their order and entries. */
export function withoutMemberRef(knowledgeMemberRefs: readonly string[], memberRef: string): string[] {
  return knowledgeMemberRefs.filter((ref) => ref !== memberRef);
}

export interface MembershipTransaction {
  getMembership(membershipId: string): Promise<unknown>;
  /** Roadmap item ids in `teamId` whose `ownerRef` equals `memberRef`, at most `limit`. */
  roadmapItemIdsOwnedBy(teamId: string, memberRef: string, limit: number): Promise<string[]>;
  clearRoadmapOwnerRef(itemId: string): void;
  /** Systems in `teamId` whose `knowledgeMemberRefs` contains `memberRef` (A-14), with their current refs, at most `limit`. */
  systemsKnowingMemberRef(teamId: string, memberRef: string, limit: number): Promise<KnowledgeSystem[]>;
  /** Replaces one system's `knowledgeMemberRefs`. Only that field changes; the system record is kept (A-14). */
  setKnowledgeMemberRefs(systemId: string, knowledgeMemberRefs: string[]): void;
  /** Project participation ids in `teamId` whose `memberRef` equals `memberRef` (A-15), at most `limit`. */
  participationIdsOf(teamId: string, memberRef: string, limit: number): Promise<string[]>;
  /** Deletes one participation record (A-15). A planning interval has no meaning once its member ref is gone. */
  deleteParticipation(participationId: string): void;
  deleteMembership(membershipId: string): void;
}

export interface MembershipErasurePort {
  runTransaction<T>(work: (tx: MembershipTransaction) => Promise<T>): Promise<T>;
  /**
   * Membership document ids that belong to the uid: documents whose `uid` field is the uid, and legacy documents with no
   * `uid` field whose id starts with `${uid}__`. At most `limit`.
   */
  membershipIdsOf(uid: string, limit: number): Promise<string[]>;
}

export interface MembershipStepDeps {
  readonly port: MembershipErasurePort;
}

export function createMembershipStepHandler(deps: MembershipStepDeps): StepHandler {
  return {
    runBatch: ({ uid, maxWrites }) => runMembershipBatch(deps, uid, maxWrites),
  };
}

export async function runMembershipBatch(
  deps: MembershipStepDeps,
  uid: string,
  maxWrites: number,
): Promise<BatchResult> {
  const { port } = deps;
  // A zero budget could report "done" while a membership remains, so it is a programming error, not a batch result.
  if (maxWrites < 1) throw new ErasureStepFailure("unexpected");

  const [next] = await port.membershipIdsOf(uid, 1);
  if (next === undefined) return "done";

  await port.runTransaction(async (tx) => {
    const raw = await tx.getMembership(next);
    if (raw === undefined) return;

    const record = parseMembershipRecord(raw);
    if (record === undefined) throw new ErasureStepFailure("verification_failed");
    const ownerIdentity = record.uid ?? (next.startsWith(`${uid}__`) ? uid : undefined);
    if (ownerIdentity !== uid) throw new ErasureStepFailure("verification_failed");

    const teamId = record.teamId ?? teamIdFromDocId(next, uid);
    if (teamId === undefined) throw new ErasureStepFailure("verification_failed");

    if (record.memberRef !== undefined) {
      // Nulling the owner references comes first; the membership is deleted only after none remain. Every read in this
      // transaction happens before its first write, as Firestore requires: the system query runs only when no roadmap
      // write was queued.
      const itemIds = await tx.roadmapItemIdsOwnedBy(teamId, record.memberRef, maxWrites);
      if (itemIds.length > 0) {
        for (const itemId of itemIds) tx.clearRoadmapOwnerRef(itemId);
        return;
      }
      const systems = await tx.systemsKnowingMemberRef(teamId, record.memberRef, maxWrites);
      if (systems.length > 0) {
        for (const system of systems) {
          tx.setKnowledgeMemberRefs(system.systemId, withoutMemberRef(system.knowledgeMemberRefs, record.memberRef));
        }
        return;
      }
      // A-15: participation records are deleted before the membership. No write is queued yet, so the read is legal.
      const participationIds = await tx.participationIdsOf(teamId, record.memberRef, maxWrites);
      if (participationIds.length > 0) {
        for (const participationId of participationIds) tx.deleteParticipation(participationId);
        return;
      }
    }

    tx.deleteMembership(next);
  });

  return "more";
}

interface ParsedMembership {
  readonly uid?: string;
  readonly teamId?: string;
  readonly memberRef?: string;
}

/** Reads the fields the step needs. A present field of the wrong type is malformed, so the step fails closed. */
function parseMembershipRecord(raw: unknown): ParsedMembership | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const uid = optionalString(record.uid);
  const teamId = optionalString(record.teamId);
  const memberRef = optionalString(record.memberRef);
  if (uid === null || teamId === null || memberRef === null) return undefined;
  return {
    ...(uid !== undefined ? { uid } : {}),
    ...(teamId !== undefined ? { teamId } : {}),
    ...(memberRef !== undefined ? { memberRef } : {}),
  };
}

/** `undefined` when absent, the string when a non-empty string, `null` when present but not a non-empty string. */
function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Legacy id parse. Assumes a generated uid never contains `__`, so the remainder after `uid__` is exactly the team id.
 * A uid that did contain `__` could otherwise make another person's legacy id look like this one; the uid field check above
 * is the primary guard for documents that have one.
 */
function teamIdFromDocId(docId: string, uid: string): string | undefined {
  const prefix = `${uid}__`;
  if (!docId.startsWith(prefix)) return undefined;
  const teamId = docId.slice(prefix.length);
  return teamId.length > 0 ? teamId : undefined;
}

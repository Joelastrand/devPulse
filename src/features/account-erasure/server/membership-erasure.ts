import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";

/**
 * The `memberships` erasure step (TASK-016; SPEC BR-10, D2, I-9, A-5). Pure logic over an injected port.
 *
 * For each of the erased person's `teamMemberships` documents, one transaction:
 *   1. nulls every `roadmapItems.ownerRef` in that team that equals this membership's opaque `memberRef`, in bounded
 *      chunks (a membership is not deleted while any such owner reference remains); then
 *   2. deletes the membership document (this ends the membership, the lead role, and the team skill contribution it
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

export interface MembershipTransaction {
  getMembership(membershipId: string): Promise<unknown>;
  /** Roadmap item ids in `teamId` whose `ownerRef` equals `memberRef`, at most `limit`. */
  roadmapItemIdsOwnedBy(teamId: string, memberRef: string, limit: number): Promise<string[]>;
  clearRoadmapOwnerRef(itemId: string): void;
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
      // Nulling the owner references comes first; the membership is deleted only after none remain.
      const itemIds = await tx.roadmapItemIdsOwnedBy(teamId, record.memberRef, maxWrites);
      if (itemIds.length > 0) {
        for (const itemId of itemIds) tx.clearRoadmapOwnerRef(itemId);
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

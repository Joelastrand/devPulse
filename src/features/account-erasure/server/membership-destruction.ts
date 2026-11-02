import type { BoundConversation, ParticipantBindingsDeps } from "./participant-bindings-erasure";
import { eraseParticipantBinding } from "./participant-bindings-erasure";

/**
 * Destruction of one membership instance for ordinary admin `removeTeamMember` (TASK-038, owner decision 2026-11-02). Account
 * erasure does NOT call this boundary: its membership step (`membership-erasure.ts`) clears A-5 in its own final transaction
 * and does not count bindings. Erasure discovers I-7 bindings by `participantUid` in its uid-addressed bindings step, which
 * runs after membership removal (SPEC BR-17(1) reasoning, review I-1). The lifecycle invariant this boundary enforces:
 *
 * After any approved destruction of a membership instance there is no memberRef-dependent reference left that refers to the
 * destroyed instance and can no longer be discovered. The memberRef-dependent references are:
 * - A-5 `roadmapItems.ownerRef == memberRef` (cleared to null, the roadmap's neutral representation);
 * - I-7 bindings `conversations.participantMemberRef == memberRef` (the existing neutral removal: the five binding fields are
 *   cleared, the participation index is deleted and the notes are dropped, through `eraseParticipantBinding`).
 *
 * Ordering. Each binding is cleared in its own owner transaction, then the membership is deleted by a FINAL transaction that
 * reads the membership, the roadmap owner set and the binding set, clears any roadmap reference it finds, and deletes the
 * membership only when both sets are empty. The final transaction therefore performs the dependent check and the delete
 * together. Concurrent writers that introduce a reference to this membership touch the membership in their own transaction
 * (A-5 roadmap owner assignment, and the invitation and replacement of a participant), so they conflict with the final
 * transaction. The port below exposes exactly the reads and writes that argument relies on, and nothing else.
 */

export interface MembershipRecordForDestruction {
  readonly uid?: unknown;
  readonly teamId?: unknown;
  readonly memberRef?: unknown;
}

/** Plain discovery, used before the final transaction to clear bindings. Never the membership's delete decision. */
export interface MembershipDestructionDiscovery {
  readMembership(membershipId: string): Promise<MembershipRecordForDestruction | undefined>;
  boundConversations(memberRef: string, limit: number): Promise<BoundConversation[]>;
}

export interface MembershipDestructionFinalTransaction {
  /** Reads the target person's erasure fence in this transaction. Refuses (throws) while a record exists. */
  assertNoErasureRecord(uid: string): Promise<void>;
  getMembership(membershipId: string): Promise<unknown>;
  roadmapItemIdsOwnedBy(teamId: string, memberRef: string, limit: number): Promise<string[]>;
  clearRoadmapOwnerRef(itemId: string): void;
  boundConversationCount(memberRef: string, limit: number): Promise<number>;
  deleteMembership(membershipId: string): void;
}

export interface MembershipDestructionPort extends MembershipDestructionDiscovery {
  /**
   * A transaction that only reads the target person's erasure fence. It runs before each round's binding cleanup, so a refused
   * removal writes nothing. The final transaction repeats the read, and that one is the atomic guard for the delete.
   */
  assertNoErasureRecord(uid: string): Promise<void>;
  runFinalTransaction<T>(work: (tx: MembershipDestructionFinalTransaction) => Promise<T>): Promise<T>;
}

/**
 * The membership being destroyed and the person it belongs to. The fence subject is the TARGET uid (the member whose membership
 * is removed), never the uid of the admin who asked for the removal (TASK-038 decision 2026-11-02).
 */
export interface MembershipDestructionTarget {
  readonly membershipId: string;
  readonly uid: string;
}

export interface MembershipDestructionDeps {
  readonly port: MembershipDestructionPort;
  /** The same binding deps the erasure binding step uses (store, codec, clock). */
  readonly bindings: ParticipantBindingsDeps;
}

/** The bound loop: a bounded number of cleanup rounds per call. Exceeding it is a failure, never a silent partial success. */
export const MAX_DESTRUCTION_ROUNDS = 50;

export class MembershipDestructionFailure extends Error {
  constructor(
    readonly reason: "membership_malformed" | "binding_cleanup_failed" | "binding_inconsistent" | "rounds_exhausted",
  ) {
    super(reason);
  }
}

/**
 * Destroys one membership instance (uid, teamId) with its memberRef-dependent references cleared first. Returns `done` once the
 * membership is absent or deleted. Retrying after any interruption re-runs the same decision from current data, so it is safe.
 */
export async function destroyMembershipInstance(
  deps: MembershipDestructionDeps,
  target: MembershipDestructionTarget,
  maxWrites: number,
): Promise<"done"> {
  if (maxWrites < 1) throw new MembershipDestructionFailure("rounds_exhausted");
  const { membershipId } = target;

  for (let round = 0; round < MAX_DESTRUCTION_ROUNDS; round += 1) {
    // Refused before any cleanup write in this round, so a fenced person's removal changes nothing (BR-4(b)).
    await deps.port.assertNoErasureRecord(target.uid);

    const record = await deps.port.readMembership(membershipId);
    // Absent: already destroyed. Retry-safe.
    if (record === undefined) return "done";

    // A membership without a memberRef (a legacy record) cannot own roadmap items or bindings, so it has no dependent cleanup.
    const { uid, teamId, memberRef } = record;
    if (uid !== undefined && uid !== target.uid) throw new MembershipDestructionFailure("membership_malformed");
    if (memberRef !== undefined && (typeof memberRef !== "string" || typeof uid !== "string" || typeof teamId !== "string")) {
      throw new MembershipDestructionFailure("membership_malformed");
    }

    if (typeof memberRef === "string") {
      // Binding cleanup first, one owner transaction per conversation. Each uses the approved removal semantics.
      const bound = await deps.port.boundConversations(memberRef, maxWrites);
      for (const binding of bound) {
        const cleaned = await eraseParticipantBinding(deps.bindings, binding, target.uid);
        if (!cleaned.ok) throw new MembershipDestructionFailure("binding_cleanup_failed");
        // A binding that still names this memberRef but is not owned by this uid cannot be cleared by the binding cleanup, which
        // only clears a binding of its own participant. Retrying would loop, so it fails at once with its own reason (TASK-038 I-2).
        if (cleaned.outcome === "skipped") throw new MembershipDestructionFailure("binding_inconsistent");
      }
    }

    // Final transaction: roadmap owner clear, and the delete only when no reference remains.
    const outcome = await deps.port.runFinalTransaction(async (tx) => {
      await tx.assertNoErasureRecord(target.uid);
      if ((await tx.getMembership(membershipId)) === undefined) return "absent" as const;
      if (typeof memberRef === "string") {
        const itemIds = await tx.roadmapItemIdsOwnedBy(teamId as string, memberRef, maxWrites);
        if (itemIds.length > 0) {
          for (const itemId of itemIds) tx.clearRoadmapOwnerRef(itemId);
          return "more" as const;
        }
        if ((await tx.boundConversationCount(memberRef, maxWrites)) > 0) return "more" as const;
      }
      tx.deleteMembership(membershipId);
      return "deleted" as const;
    });

    if (outcome === "absent" || outcome === "deleted") return "done";
  }
  throw new MembershipDestructionFailure("rounds_exhausted");
}

import "server-only";
import { isConversationId } from "../domain/conversation-id";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import type { ConversationErrorCode } from "../domain/errors";
import type { UpdateOwnerSectionsCodec } from "./update-owner-sections";
import type { ConversationStore } from "./conversation-store-types";
import { classifyOwnerDocument } from "./owner-read";
import { readOwnedGoalSnapshots, type OwnedGoalReader } from "./read-owned-goal-snapshots";

/**
 * Owner goal-snapshot set write (SPEC BR-24 to BR-27, BR-48, BR-50 (4), AD-6, CL-26, D2-SI-5, D2-SI-9; TASK-013).
 * The owner replaces the whole `sharedGoals` set in one transaction. Only the snapshot material is stored, inside the
 * encrypted payload, and no goal id is written (BR-26). An empty list clears the set, which is allowed after completion
 * (BR-27, CL-26). A non-empty list on a completed conversation is refused.
 *
 * The D1 goal reads run before the transaction (BR-24, BR-50 (4)). The status is checked again inside the transaction,
 * so a completion that lands between the reads and the write is still refused. The owner uid is the first argument and
 * is never read from the input. Deps are required: this module does not import the D1 goal store (the scope guard
 * allows only `read-owned-goal-snapshots.ts`), so the route supplies the goal reader.
 */

export interface SetSharedGoalsDeps {
  store: ConversationStore;
  codec: UpdateOwnerSectionsCodec;
  /** The D1 read seam from TASK-008. Production wiring is supplied by the route (TASK-023). */
  goalStore: OwnedGoalReader;
  /** Server time for `updatedAt` and `capturedAt` (BR-25). Injected so tests can fix it. */
  clock: () => Date;
}

export type SetSharedGoalsResult =
  | { ok: true }
  | {
      ok: false;
      error: Extract<ConversationErrorCode, "conversation_not_found" | "conversation_completed" | "invalid_goal_selection" | "persistence_failed">;
    };

const NOT_FOUND: SetSharedGoalsResult = { ok: false, error: "conversation_not_found" };
const FAILED: SetSharedGoalsResult = { ok: false, error: "persistence_failed" };

/** An empty list is the clear request. It is the only input that skips the goal reads, since it selects no goal. */
function isClearRequest(goalIds: unknown): boolean {
  return Array.isArray(goalIds) && goalIds.length === 0;
}

export async function setSharedGoals(
  ownerUid: string,
  conversationId: string,
  goalIds: unknown,
  deps: SetSharedGoalsDeps,
): Promise<SetSharedGoalsResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;
  // BR-53: the key probe runs before any document is read or written.
  if (!deps.codec.probeKey().ok) return FAILED;

  try {
    let snapshots: SharedGoalSnapshot[] = [];
    if (!isClearRequest(goalIds)) {
      // BR-24, BR-50 (4): every goal is read before the transaction. Any failure rejects the whole call; nothing is written.
      const read = await readOwnedGoalSnapshots(ownerUid, goalIds, { goalStore: deps.goalStore, clock: deps.clock });
      if (!read.ok) return { ok: false, error: read.error };
      snapshots = read.snapshots;
    }

    const now = deps.clock();
    return await deps.store.runTransaction(async (tx): Promise<SetSharedGoalsResult> => {
      const raw = await tx.getOwner(ownerUid, conversationId);
      if (raw === undefined) return NOT_FOUND;

      const classification = classifyOwnerDocument(raw, deps.codec);
      if (classification.kind !== "valid") return NOT_FOUND;
      const record = classification.record;

      // BR-27, CL-26: after completion the set may only be cleared. The status is read here, inside the transaction (BR-50 (4)).
      if (record.status === "completed" && snapshots.length > 0) return { ok: false, error: "conversation_completed" };

      // Only `sharedGoals` changes. The other encrypted fields are carried over unchanged (BR-49).
      const encoded = deps.codec.encodeContent({
        title: record.content.title,
        ownerNotes: record.content.ownerNotes,
        nextSteps: record.content.nextSteps,
        participantNotes: record.content.participantNotes,
        sharedGoals: snapshots,
      });
      if (!encoded.ok) return FAILED;

      tx.updateOwner(ownerUid, conversationId, { updatedAt: new Date(now.getTime()), ...encoded.content });
      return { ok: true };
    });
  } catch {
    // Any read, key or write failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

import "server-only";
import { decryptForClassification, encodeContent, probeKey } from "./content-codec";
import { getDefaultConversationStore } from "./conversation-store";
import { createProductionParticipantStateResolver } from "./owner-participant-state";
import type { OwnerReadDeps } from "./owner-read";
import { productionOwnedGoalReader } from "./read-owned-goal-snapshots";
import { productionOwnedEvidenceReader } from "./owned-evidence-seam";
import type { SetSharedEvidenceDeps } from "./set-shared-evidence";
import type { SelectableEvidenceDeps } from "./list-selectable-evidence";
import type { SetSharedGoalsDeps } from "./set-shared-goals";
import { createFirestoreSharedTeamReader } from "./shared-team-binding";

/**
 * Production dependencies for the owner routes (TASK-023). The route files import only this module and the operations,
 * never the store, the codec or the D1 goal store directly. Nothing here decides access: the operations own every check.
 */

/** Deps for the owner list and detail reads (TASK-011), with the production BR-21 resolver (TASK-023). */
export function productionOwnerReadDeps(): OwnerReadDeps {
  const store = getDefaultConversationStore();
  const teamReader = createFirestoreSharedTeamReader();
  return {
    store,
    codec: { probeKey, decryptForClassification },
    teamReader,
    resolveParticipantState: createProductionParticipantStateResolver(store),
  };
}


/** Deps for the owner goal-snapshot set write (TASK-013). The D1 read comes from the snapshot seam only. */
export function productionSetSharedGoalsDeps(): SetSharedGoalsDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey, decryptForClassification, encodeContent },
    goalStore: productionOwnedGoalReader(),
    clock: () => new Date(),
  };
}

/** Deps for the owner evidence-selection write (TASK-007). The personal source read comes from the evidence seam only. */
export function productionSetSharedEvidenceDeps(): SetSharedEvidenceDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey, decryptForClassification, encodeContent },
    reader: productionOwnedEvidenceReader(),
    clock: () => new Date(),
  };
}

/** Deps for the owner-only selectable evidence list (TASK-007). */
export function productionSelectableEvidenceDeps(): SelectableEvidenceDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey, decryptForClassification },
    reader: productionOwnedEvidenceReader(),
  };
}

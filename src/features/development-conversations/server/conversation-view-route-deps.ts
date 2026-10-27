import "server-only";
import { decryptForClassification, probeKey } from "./content-codec";
import { getDefaultConversationStore } from "./conversation-store";
import type { ReadConversationForCallerDeps } from "./read-conversation-for-caller";
import { createFirestoreTeamNameReader } from "./read-pending-invitation";
import { productionOwnerReadDeps } from "./owner-route-deps";
import { createFirestoreTeamEligibilityReader } from "./team-eligibility";

/**
 * Production dependencies for the caller's conversation detail (TASK-024). Owner, accepted participant and pending reads
 * are composed here, each with its own inputs, and the route imports only this module. Nothing here decides access.
 */
export function productionConversationViewDeps(): ReadConversationForCallerDeps {
  const store = getDefaultConversationStore();
  const teamReader = createFirestoreTeamEligibilityReader();
  const teamNameReader = createFirestoreTeamNameReader();
  return {
    store,
    owner: productionOwnerReadDeps(),
    participant: { store, codec: { probeKey, decryptForClassification }, teamReader, teamNameReader },
    pending: { store, teamReader, teamNameReader },
  };
}

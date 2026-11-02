import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { BoundConversation, ParticipantBindingDiscovery } from "./participant-bindings-erasure";

/**
 * Production discovery of the conversations bound to a participant (I-8, TASK-019), as a collection-group query on
 * `conversations` where `participantUid == uid`. It requires the approved AE-IDX-1 index (firestore.indexes.json, TASK-008),
 * and it is registered only in the account-erasure composition, never in the D2 store. Keys only: the query selects no
 * fields, and the owner and conversation ids come from the document path. A path that does not have the expected shape
 * fails closed (it throws, which the runner records as `unexpected`).
 */

const CONVERSATIONS = "conversations";
const USER_DEVELOPMENT = "userDevelopment";

export function createParticipantBindingDiscovery(): ParticipantBindingDiscovery {
  return {
    async listBoundTo(uid, limit): Promise<BoundConversation[]> {
      if (uid.length === 0 || uid.includes("/")) throw new Error("erasure adapter: invalid uid segment");
      const snapshot = await getFirestoreDb()
        .collectionGroup(CONVERSATIONS)
        .where("participantUid", "==", uid)
        .select()
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => parseOwnedConversationPath(doc.ref.path));
    },
  };
}

/** `userDevelopment/{ownerUid}/conversations/{conversationId}` → the owner and conversation ids; anything else throws. */
export function parseOwnedConversationPath(path: string): BoundConversation {
  const segments = path.split("/");
  if (segments.length !== 4 || segments[0] !== USER_DEVELOPMENT || segments[2] !== CONVERSATIONS) {
    throw new Error("erasure adapter: unexpected conversation document path");
  }
  return { ownerUid: segments[1] as string, conversationId: segments[3] as string };
}

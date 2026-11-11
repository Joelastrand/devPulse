import "server-only";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationErrorCode } from "../domain/errors";
import type { SelectableEvidenceItem } from "../../personal-role-workspace/server/owned-evidence-source";
import type { ConversationStore } from "./conversation-store-types";
import { classifyOwnerDocument, type OwnerReadCodec } from "./owner-read";
import type { OwnedEvidenceReader } from "./owned-evidence-seam";

/**
 * Owner-only list of the records the owner may select as evidence (SPEC BR-41; SECURITY-REVIEW N-E2). This is the one D2
 * response that carries source ids, and it is never sent to a participant. The verified owner must hold the conversation
 * document under their own uid, so a foreign or unknown conversation id gets the same neutral answer.
 *
 * It returns the owner's own decrypted titles and kinds only. No goal, responsibility link, role or team field is included.
 */

export interface SelectableEvidenceDeps {
  store: ConversationStore;
  codec: OwnerReadCodec & { probeKey: () => { ok: boolean } };
  reader: OwnedEvidenceReader;
}

export type SelectableEvidenceResult =
  | { ok: true; items: SelectableEvidenceItem[]; truncated: boolean }
  | { ok: false; error: Extract<ConversationErrorCode, "conversation_not_found" | "persistence_failed"> };

export async function listSelectableEvidenceForOwner(
  ownerUid: string,
  conversationId: string,
  deps: SelectableEvidenceDeps,
): Promise<SelectableEvidenceResult> {
  if (!isConversationId(conversationId)) return { ok: false, error: "conversation_not_found" };
  if (!deps.codec.probeKey().ok) return { ok: false, error: "persistence_failed" };

  try {
    const raw = await deps.store.getOwner(ownerUid, conversationId);
    if (raw === undefined) return { ok: false, error: "conversation_not_found" };
    const classification = classifyOwnerDocument(raw, deps.codec);
    if (classification.kind !== "valid") return { ok: false, error: "conversation_not_found" };

    const list = await deps.reader.list(ownerUid);
    if (!list.ok) return { ok: false, error: "persistence_failed" };
    return { ok: true, items: list.list.items, truncated: list.list.truncated };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

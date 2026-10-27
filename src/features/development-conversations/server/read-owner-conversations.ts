import "server-only";
import { READ_WINDOW } from "../domain/conversation-constants";
import type { ConversationStatus } from "../domain/conversation-status";
import type { StoredConversation } from "../domain/stored-owner-conversation";
import {
  classifyOwnerDocument,
  participantStateOf,
  rosterRequestFor,
  type OwnerParticipantDto,
  type OwnerReadDeps,
} from "./owner-read";
import { resolveRosterNames } from "./participant-presentation";
import { requestScopedTeamReader } from "./request-scoped-team-reader";

/**
 * Owner list (SPEC BR-33, BR-36, BR-44, BR-53; TASK-011). Returns the caller's owner summaries and recovery items.
 * The owner uid is the first argument and is the only subject. The list performs no area-name resolution: owner
 * summaries carry no `areaName` (product-owner decision, 2026-10-17).
 */

export type ReadOwnerConversationsDeps = OwnerReadDeps;

/** One owner summary (BR-44). Keys are exactly `OWNER_SUMMARY_KEYS`. */
export interface OwnerConversationSummary {
  conversationId: string;
  title: string;
  status: ConversationStatus;
  plannedFor: string | null;
  participant: OwnerParticipantDto;
  sharedGoalCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A delete-only item for a document the owner cannot see (BR-33, BR-44). */
export interface OwnerRecoveryItem {
  conversationId: string;
}

export type ReadOwnerConversationsResult =
  | {
      ok: true;
      conversations: OwnerConversationSummary[];
      recovery: OwnerRecoveryItem[];
      /** `true` when the query returned more than `READ_WINDOW` documents (BR-33). */
      truncated: boolean;
    }
  | { ok: false; error: "persistence_failed" };

const FAILED: ReadOwnerConversationsResult = { ok: false, error: "persistence_failed" };

export async function readOwnerConversations(ownerUid: string, deps: ReadOwnerConversationsDeps): Promise<ReadOwnerConversationsResult> {
  // BR-53: one key probe per request, before any document is classified. A failure returns no items.
  if (!deps.codec.probeKey().ok) return FAILED;

  try {
    const window = await deps.store.listOwnerWindow(ownerUid);
    const missing = await deps.store.scanOwnerMissingCreatedAt(ownerUid);

    // Documents without createdAt are missing from the ordered window, so they are read by id and classified the same way.
    // The window and the scan are separate reads, so an id can name a document in both if it changes between them. Each
    // id is classified once, and the ordered window wins.
    const documents: Array<{ id: string; raw: unknown }> = window.docs.map((doc) => ({ id: doc.id, raw: doc.data }));
    const seen = new Set(documents.map((doc) => doc.id));
    for (const id of missing.missingCreatedAtIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const raw = await deps.store.getOwner(ownerUid, id);
      if (raw !== undefined) documents.push({ id, raw });
    }

    const valid: Array<{ id: string; record: StoredConversation }> = [];
    const recovery: OwnerRecoveryItem[] = [];
    for (const document of documents) {
      const classification = classifyOwnerDocument(document.raw, deps.codec);
      if (classification.kind === "valid") {
        valid.push({ id: document.id, record: classification.record });
      } else {
        recovery.push({ conversationId: document.id });
      }
    }

    // One memo of the raw team and membership reads for this list (TASK-023). It is shared by the BR-21 resolver and the
    // roster, and it is never kept past this call. Each item's binding is still decided per conversation.
    const reads = requestScopedTeamReader(deps.teamReader);
    const states = await Promise.all(
      valid.map(({ id, record }) => participantStateOf(ownerUid, id, record, deps.resolveParticipantState, reads)),
    );
    const requests = valid.flatMap(({ record }) => {
      const request = rosterRequestFor(ownerUid, record);
      return request === null ? [] : [request];
    });
    const names = await resolveRosterNames(requests, { teamReader: reads, getNames: deps.getNames });
    if (!names.ok) return FAILED;

    const conversations = valid.map(({ id, record }, index): OwnerConversationSummary => {
      const request = rosterRequestFor(ownerUid, record);
      return {
        conversationId: id,
        title: record.content.title,
        status: record.status,
        plannedFor: record.plannedFor,
        participant: { state: states[index], displayName: request === null ? null : names.displayNameOf(request) },
        sharedGoalCount: record.content.sharedGoals.length,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    });

    return { ok: true, conversations, recovery, truncated: window.rawCount > READ_WINDOW };
  } catch {
    // Any read, key or classification failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

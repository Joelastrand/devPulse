import "server-only";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationStatus } from "../domain/conversation-status";
import type { StoredConversation } from "../domain/stored-owner-conversation";
import { resolveAreaNames, type SkillTreeNameReader } from "./area-names";
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
 * Owner detail (SPEC BR-35, BR-42, BR-45, BR-53; TASK-011). A point read of the caller's own document. Malformed,
 * unauthenticated and foreign documents are all `conversation_not_found`; a key or read failure is `persistence_failed`.
 */

export interface ReadOwnerConversationDeps extends OwnerReadDeps {
  /** The SkillTree catalog reader for area names (TASK-009 seam). Production uses the default reader. */
  areaNameReader?: SkillTreeNameReader;
}

/** One goal snapshot as the owner sees it (BR-42). */
export interface OwnerSharedGoalDto {
  goalTitle: string;
  areaName: string | null;
  targetDate: string | null;
  status: "active" | "completed";
  capturedAt: Date;
}

/** The owner DTO (BR-42). Keys are exactly `OWNER_DTO_KEYS`. No uid, e-mail, membership id or `memberRef`. */
export interface OwnerConversationDto {
  conversationId: string;
  title: string;
  status: ConversationStatus;
  plannedFor: string | null;
  teamId: string | null;
  participant: OwnerParticipantDto;
  ownerNotes: string;
  nextSteps: string[];
  participantNotes: string;
  sharedGoals: OwnerSharedGoalDto[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export type ReadOwnerConversationResult =
  | { ok: true; conversation: OwnerConversationDto }
  | { ok: false; error: "conversation_not_found" | "persistence_failed" };

const NOT_FOUND: ReadOwnerConversationResult = { ok: false, error: "conversation_not_found" };
const FAILED: ReadOwnerConversationResult = { ok: false, error: "persistence_failed" };

export async function readOwnerConversation(
  ownerUid: string,
  conversationId: string,
  deps: ReadOwnerConversationDeps,
): Promise<ReadOwnerConversationResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;
  // BR-53: the key probe runs before any document is decrypted.
  if (!deps.codec.probeKey().ok) return FAILED;

  try {
    const raw = await deps.store.getOwner(ownerUid, conversationId);
    if (raw === undefined) return NOT_FOUND;

    const classification = classifyOwnerDocument(raw, deps.codec);
    if (classification.kind !== "valid") return NOT_FOUND;
    const record: StoredConversation = classification.record;

    // Area names: at most SHARED_GOALS_MAX distinct trees, one point read each (BR-45, D2-SI-5). A failed read is never
    // shown as "area unavailable".
    const treeIds = record.content.sharedGoals.flatMap((goal) => (goal.treeId === null ? [] : [goal.treeId]));
    const areas = await resolveAreaNames(treeIds, deps.areaNameReader);
    if (!areas.ok) return FAILED;

    // One request memo of the raw team and membership reads, shared by the resolver and the roster (TASK-023).
    const reads = requestScopedTeamReader(deps.teamReader);
    const state = await participantStateOf(ownerUid, conversationId, record, deps.resolveParticipantState, reads);
    const request = rosterRequestFor(ownerUid, record);
    const names = await resolveRosterNames(request === null ? [] : [request], {
      teamReader: reads,
      getNames: deps.getNames,
    });
    if (!names.ok) return FAILED;

    return {
      ok: true,
      conversation: {
        conversationId,
        title: record.content.title,
        status: record.status,
        plannedFor: record.plannedFor,
        teamId: record.teamId,
        participant: { state, displayName: request === null ? null : names.displayNameOf(request) },
        ownerNotes: record.content.ownerNotes,
        nextSteps: record.content.nextSteps,
        participantNotes: record.content.participantNotes,
        sharedGoals: record.content.sharedGoals.map((goal) => ({
          goalTitle: goal.goalTitle,
          areaName: goal.treeId === null ? null : (areas.names.get(goal.treeId) ?? null),
          targetDate: goal.targetDate,
          status: goal.status,
          capturedAt: goal.capturedAt,
        })),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        completedAt: record.completedAt,
      },
    };
  } catch {
    // Any read, key or classification failure is operational. The raw error is never surfaced (BR-47).
    return FAILED;
  }
}

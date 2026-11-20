import "server-only";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationStatus } from "../domain/conversation-status";
import type { SharedEvidenceSnapshot } from "../domain/shared-evidence-snapshot";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { resolveAreaNames, type SkillTreeNameReader } from "./area-names";
import { authorizeParticipant, participantOwnerUid } from "./authorize-participant";
import type { ConversationStore } from "./conversation-store-types";
import { classifyOwnerDocument, type OwnerReadCodec } from "./owner-read";
import { resolveRosterNames, type RosterNameDeps } from "./participant-presentation";
import type { OwnerSharedGoalDto } from "./read-owner-conversation";
import { authorizeBoundParticipant, type SharedTeamReader } from "./shared-team-binding";

/**
 * Accepted participant detail (SPEC BR-21, BR-22, BR-43, BR-45, BR-53, CL-18, D2-SI-6, D2-SI-14; TASK-017, A2.1). The only
 * participant content read. Every denial, whatever its cause, is `conversation_not_found`. A read, key or membership
 * failure is `persistence_failed`, and it is never reported as a denial.
 *
 * Order: index, owner plain shape, the shared-team binding (`authorizeBoundParticipant`), then the single authorization
 * decision. Content is decrypted only after that decision allows it, and the key is probed on this request (BR-53). A
 * conversation has no team, so the response carries no team name.
 */

export interface ReadParticipantConversationDeps {
  store: ConversationStore;
  codec: OwnerReadCodec;
  teamReader: SharedTeamReader;
  /** The SkillTree catalog reader for area names. Production uses the default reader. */
  areaNameReader?: SkillTreeNameReader;
  /** Production uses the roster-rule default; tests inject a fake. */
  getNames?: RosterNameDeps["getNames"];
}

/** The participant DTO (BR-43). Keys are exactly `PARTICIPANT_DTO_KEYS`. No uid, e-mail, membership id or `memberRef`. */
export interface ParticipantConversationDto {
  conversationId: string;
  title: string;
  status: ConversationStatus;
  plannedFor: string | null;
  ownerDisplayName: string | null;
  ownerNotes: string;
  nextSteps: string[];
  /** The caller's own text (BR-20, BR-43). */
  participantNotes: string;
  sharedGoals: OwnerSharedGoalDto[];
  /** Owner-selected evidence snapshots, visible after acceptance only (BR-46). Stored copies only. */
  sharedEvidence: SharedEvidenceSnapshot[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export type ReadParticipantConversationResult =
  | { ok: true; dto: ParticipantConversationDto }
  | { ok: false; error: "conversation_not_found" | "persistence_failed" };

const NOT_FOUND: ReadParticipantConversationResult = { ok: false, error: "conversation_not_found" };
const FAILED: ReadParticipantConversationResult = { ok: false, error: "persistence_failed" };

export async function readParticipantConversation(
  callerUid: string,
  conversationId: string,
  deps: ReadParticipantConversationDeps,
): Promise<ReadParticipantConversationResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;

  try {
    // BR-21 (a): the caller's index entry names the owner. A malformed entry is treated as absent (BR-34).
    const rawIndex = await deps.store.getParticipation(callerUid, conversationId);
    if (rawIndex === undefined) return NOT_FOUND;
    const ownerUid = participantOwnerUid(rawIndex);
    if (ownerUid === null) return NOT_FOUND;

    // BR-21 (b): the owner document must exist and have a valid plain shape. Nothing is decrypted yet.
    const rawOwner = await deps.store.getOwner(ownerUid, conversationId);
    if (rawOwner === undefined) return NOT_FOUND;
    const shape = classifyStoredShape(rawOwner);
    if (shape.kind !== "valid" || shape.record.participant === null) return NOT_FOUND;

    // BR-21 (d) and (e): a shared active team and the bound membership instance. A failed read is operational.
    const binding = await authorizeBoundParticipant(ownerUid, callerUid, shape.record.participant.bindings, deps.teamReader);
    if (!binding.ok && binding.error === "read_failed") return FAILED;

    // BR-21 (a) to (e): the single decision. Every denial is the same not-found result.
    const decision = authorizeParticipant({ callerUid, index: rawIndex, owner: rawOwner, binding });
    if (!decision.allowed) return NOT_FOUND;

    // BR-53: the key is probed on this request, then the payload is decrypted and validated. A key failure throws out
    // of the classifier and is caught below as persistence_failed. Malformed or unauthenticated content is not found.
    if (!deps.codec.probeKey().ok) return FAILED;
    const classification = classifyOwnerDocument(rawOwner, deps.codec, { ownerUid, conversationId });
    if (classification.kind !== "valid") return NOT_FOUND;
    const record = classification.record;

    // BR-45: at most SHARED_GOALS_MAX distinct trees, one point read each. A failed read is never "area unavailable".
    const treeIds = record.content.sharedGoals.flatMap((goal) => (goal.treeId === null ? [] : [goal.treeId]));
    const areas = await resolveAreaNames(treeIds, deps.areaNameReader);
    if (!areas.ok) return FAILED;

    // BR-41 roster rule: the owner's name only when both parties hold an active membership of the shared team.
    const request = { viewerUid: callerUid, teamId: decision.teamId, subjectUid: decision.ownerUid };
    const names = await resolveRosterNames([request], { teamReader: deps.teamReader, getNames: deps.getNames });
    if (!names.ok) return FAILED;

    return {
      ok: true,
      dto: {
        conversationId,
        title: record.content.title,
        status: record.status,
        plannedFor: record.plannedFor,
        ownerDisplayName: names.displayNameOf(request),
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
        sharedEvidence: record.content.sharedEvidence,
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

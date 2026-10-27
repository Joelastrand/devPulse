import "server-only";
import {
  classifyStoredConversation,
  type DecryptOutcome,
  type StoredConversation,
  type StoredConversationClassification,
  type StoredEnvelope,
} from "../domain/stored-owner-conversation";
import type { ProbeKeyResult } from "./content-codec";
import type { ConversationStore } from "./conversation-store-types";
import type { RosterNameDeps } from "./participant-presentation";
import type { TeamEligibilityReader } from "./team-eligibility";

/**
 * Shared pieces of the owner read operations (TASK-011): the injected seams, the participant-state derivation and the
 * owner summary fields. The list and the detail both use these, so they classify and describe a binding the same way.
 * Imports no area-name seam, so the list path cannot reach the SkillTree catalog through this module.
 */

/** The only codec operations an owner read needs. The real codec module and the test fake both satisfy it. */
export interface OwnerReadCodec {
  probeKey(): ProbeKeyResult;
  decryptForClassification(envelope: StoredEnvelope): DecryptOutcome;
}

export interface ParticipantStateInput {
  ownerUid: string;
  conversationId: string;
  teamId: string;
  participantUid: string;
  /**
   * The request's team and membership reader (a request-scoped memo of raw reads, TASK-023). The resolver makes its own
   * binding decision for this conversation from these raw reads; the memo never decides anything.
   */
  teamReader: TeamEligibilityReader;
}

/**
 * The injected BR-21 check for a bound participant. It resolves `true` when the binding currently holds, and `false`
 * when it does not (the owner then sees `unavailable`, BR-42). It rejects on an operational failure, which fails the
 * request. TASK-017 supplies the real check; no read operation implements BR-21 itself.
 */
export type ParticipantStateResolver = (input: ParticipantStateInput) => Promise<boolean>;

export interface OwnerReadDeps {
  store: ConversationStore;
  codec: OwnerReadCodec;
  teamReader: TeamEligibilityReader;
  resolveParticipantState: ParticipantStateResolver;
  /** Production uses the default name lookup; tests inject a fake. */
  getNames?: RosterNameDeps["getNames"];
}

export type OwnerParticipantState = "none" | "pending" | "accepted" | "unavailable";

/**
 * Classifies one raw owner document (SPEC BR-33, BR-53). A key failure throws out of the classifier and is not caught
 * here, so the caller reports it as `persistence_failed` and never as a recovery item.
 */
export function classifyOwnerDocument(raw: unknown, codec: OwnerReadCodec): StoredConversationClassification {
  return classifyStoredConversation(raw, codec.decryptForClassification);
}

/** The state of a valid record's binding. `unavailable` when a bound participant fails BR-21 (BR-42). */
export async function participantStateOf(
  ownerUid: string,
  conversationId: string,
  record: StoredConversation,
  resolve: ParticipantStateResolver,
  teamReader: TeamEligibilityReader,
): Promise<OwnerParticipantState> {
  if (record.participant === null) return "none";
  // A participant exists only when a team is linked (BR-2), so a missing team is never a valid binding.
  if (record.teamId === null) return "unavailable";
  const holds = await resolve({
    ownerUid,
    conversationId,
    teamId: record.teamId,
    participantUid: record.participant.uid,
    teamReader,
  });
  return holds ? record.participant.state : "unavailable";
}

/** The roster-rule request for a record's participant, or `null` when there is no participant to name. */
export function rosterRequestFor(ownerUid: string, record: StoredConversation): { viewerUid: string; teamId: string; subjectUid: string } | null {
  if (record.participant === null || record.teamId === null) return null;
  return { viewerUid: ownerUid, teamId: record.teamId, subjectUid: record.participant.uid };
}

export interface OwnerParticipantDto {
  state: OwnerParticipantState;
  displayName: string | null;
}

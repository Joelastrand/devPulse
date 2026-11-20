import "server-only";
import {
  classifyStoredConversation,
  conversationContext,
  type DecryptOutcome,
  type StoredConversation,
  type StoredConversationClassification,
  type StoredEnvelope,
} from "../domain/stored-owner-conversation";
import type { ProbeKeyResult } from "./content-codec";
import type { ConversationStore } from "./conversation-store-types";
import type { RosterNameDeps } from "./participant-presentation";
import type { SharedTeamReader } from "./shared-team-binding";

/**
 * Shared pieces of the owner read operations (TASK-011): the injected seams, the participant-state derivation and the
 * owner summary fields. The list and the detail both use these, so they classify and describe a binding the same way.
 * Imports no area-name seam, so the list path cannot reach the SkillTree catalog through this module.
 */

/** The only codec operations an owner read needs. The real codec module and the test fake both satisfy it. */
export interface OwnerReadCodec {
  probeKey(): ProbeKeyResult;
  decryptForClassification(envelope: StoredEnvelope, context: string): DecryptOutcome;
}

export interface ParticipantStateInput {
  ownerUid: string;
  conversationId: string;
  participantUid: string;
  /**
   * The request's reader (a request-scoped memo of raw reads, TASK-023). The resolver makes its own binding decision for this
   * conversation from these raw reads; the memo never decides anything.
   */
  teamReader: SharedTeamReader;
}

/**
 * The result of the shared-team binding check. `holds` carries the shared team the binding was verified in, which the owner
 * roster uses for names. It never comes from the conversation document, because a conversation has no team (A2.1).
 */
export type SharedBinding = { holds: true; teamId: string } | { holds: false };

/**
 * The injected BR-21 check for a bound participant. It resolves `{ holds: false }` when the binding does not hold (the owner
 * then sees `unavailable`, BR-42). It rejects on an operational failure, which fails the request. No read operation
 * implements BR-21 itself.
 */
export type ParticipantStateResolver = (input: ParticipantStateInput) => Promise<SharedBinding>;

export interface OwnerReadDeps {
  store: ConversationStore;
  codec: OwnerReadCodec;
  teamReader: SharedTeamReader;
  resolveParticipantState: ParticipantStateResolver;
  /** Production uses the default name lookup; tests inject a fake. */
  getNames?: RosterNameDeps["getNames"];
}

export type OwnerParticipantState = "none" | "pending" | "accepted" | "unavailable";

/**
 * Classifies one raw owner document (SPEC BR-33, BR-53). A key failure throws out of the classifier and is not caught
 * here, so the caller reports it as `persistence_failed` and never as a recovery item.
 */
export function classifyOwnerDocument(
  raw: unknown,
  codec: OwnerReadCodec,
  owner: { ownerUid: string; conversationId: string },
): StoredConversationClassification {
  // The record context is rebuilt from the document path, so a stored document opens only as the owner's own record.
  const context = conversationContext(owner.ownerUid, owner.conversationId);
  return classifyStoredConversation(raw, (envelope) => codec.decryptForClassification(envelope, context));
}

/**
 * The state of a valid record's binding, and the shared team it was verified in (null when there is no binding to name).
 * `unavailable` when a bound participant fails BR-21 (BR-42).
 */
export async function participantStateOf(
  ownerUid: string,
  conversationId: string,
  record: StoredConversation,
  resolve: ParticipantStateResolver,
  teamReader: SharedTeamReader,
): Promise<{ state: OwnerParticipantState; sharedTeamId: string | null }> {
  if (record.participant === null) return { state: "none", sharedTeamId: null };
  const binding = await resolve({ ownerUid, conversationId, participantUid: record.participant.uid, teamReader });
  if (!binding.holds) return { state: "unavailable", sharedTeamId: null };
  return { state: record.participant.state, sharedTeamId: binding.teamId };
}

/** The roster-rule request for a record's participant, or `null` when there is no verified shared team to name them in. */
export function rosterRequestFor(
  ownerUid: string,
  record: StoredConversation,
  sharedTeamId: string | null,
): { viewerUid: string; teamId: string; subjectUid: string } | null {
  if (record.participant === null || sharedTeamId === null) return null;
  return { viewerUid: ownerUid, teamId: sharedTeamId, subjectUid: record.participant.uid };
}

export interface OwnerParticipantDto {
  state: OwnerParticipantState;
  displayName: string | null;
}

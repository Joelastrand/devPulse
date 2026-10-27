import "server-only";
import type { ConversationContent } from "../domain/content-payload";
import type { ConversationStatus } from "../domain/conversation-status";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import type { ConversationStore } from "./conversation-store-types";
import type { FakeContentCodec } from "./fake-content-codec";
import type { FakeTeamEligibilityState } from "./fake-team-eligibility";

/**
 * Synthetic fixtures for the owner read tests (TASK-011). Every uid, team id and title is fictional. Nothing here is
 * real person or wellbeing data.
 */

export const OWNER_UID = "owner-1";
export const OTHER_OWNER_UID = "owner-2";
export const TEAM_ID = "team-alpha";
export const PARTICIPANT_UID = "participant-1";
export const PARTICIPANT_MEMBER_REF = "0123456789abcdefghjkmnpqrs";
export const NOW = new Date("2026-10-17T09:30:00.000Z");

/** A membership document that passes the TASK-006 check for `uid` in `teamId`. */
function membershipDoc(uid: string, teamId: string): Record<string, unknown> {
  return { uid, teamId, createdAt: new Date(0), memberRef: PARTICIPANT_MEMBER_REF };
}

/** An active team with active memberships for the listed uids, and no others. */
export function rosterTeam(memberUids: readonly string[]): FakeTeamEligibilityState {
  return {
    teamStatus: { [TEAM_ID]: "active" },
    memberships: Object.fromEntries(memberUids.map((uid) => [`${uid}__${TEAM_ID}`, membershipDoc(uid, TEAM_ID)])),
  };
}

export interface SeedOwnerConversationOptions {
  ownerUid?: string;
  conversationId: string;
  title?: string;
  createdAt?: Date;
  status?: ConversationStatus;
  teamId?: string | null;
  plannedFor?: string | null;
  participant?: { uid: string; state: "pending" | "accepted" };
  sharedGoals?: SharedGoalSnapshot[];
  ownerNotes?: string;
  nextSteps?: string[];
  participantNotes?: string;
}

/**
 * Writes one canonical owner document through the fake codec and the fake store, the way TASK-010 creates it. Only the
 * fixture options vary; the plaintext content lives inside the fake codec's envelope, never in the stored plain fields.
 */
export async function seedOwnerConversation(
  store: ConversationStore,
  codec: FakeContentCodec,
  options: SeedOwnerConversationOptions,
): Promise<void> {
  const content: ConversationContent = {
    title: options.title ?? "Synthetic conversation",
    ownerNotes: options.ownerNotes ?? "",
    nextSteps: options.nextSteps ?? [],
    participantNotes: options.participantNotes ?? "",
    sharedGoals: options.sharedGoals ?? [],
  };
  const encoded = codec.encodeContent(content);
  if (!encoded.ok) throw new Error("fixture key unavailable");

  const createdAt = options.createdAt ?? NOW;
  const status = options.status ?? "open";
  const invitedAt = options.participant ? new Date(createdAt.getTime() + 1000) : null;
  await store.runTransaction(async (tx) => {
    tx.createOwner(options.ownerUid ?? OWNER_UID, options.conversationId, {
      teamId: options.teamId === undefined ? TEAM_ID : options.teamId,
      participantUid: options.participant?.uid ?? null,
      participantMemberRef: options.participant ? PARTICIPANT_MEMBER_REF : null,
      participantState: options.participant?.state ?? null,
      participantInvitedAt: invitedAt,
      participantAcceptedAt: options.participant?.state === "accepted" ? new Date(createdAt.getTime() + 2000) : null,
      plannedFor: options.plannedFor ?? null,
      status,
      completedAt: status === "completed" ? new Date(createdAt.getTime() + 3000) : null,
      createdAt,
      updatedAt: new Date(createdAt.getTime()),
      ...encoded.content,
    });
  });
}

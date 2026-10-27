import "server-only";
import { CONVERSATION_LIMIT } from "../domain/conversation-constants";
import type { ConversationContent } from "../domain/content-payload";
import { normalizePlannedFor } from "../domain/plan-date";
import { normalizeTitle } from "../domain/text-rules";
import { encodeContent as encodeContentWithKey, probeKey as probeKeyOnce } from "./content-codec";
import type { EncodeContentResult, ProbeKeyResult } from "./content-codec";
import { getDefaultConversationStore } from "./conversation-store";
import type { ConversationStore } from "./conversation-store-types";
import {
  createFirestoreTeamEligibilityReader,
  isTeamIdSegment,
  ownerCanInvite,
  type TeamEligibilityReader,
} from "./team-eligibility";

/**
 * Owner create (SPEC BR-1, BR-2, BR-3, BR-9, BR-37, BR-53; TASK-010). Creates an `open` conversation for the verified
 * owner. The owner uid is the first argument and is never read from the input. The input arrives from the route
 * layer (TASK-023) as `unknown` and is validated here again, so the operation never trusts its caller's types.
 */

/** The only codec operations create needs. The real codec module and the test fake both satisfy it. */
export interface CreateConversationCodec {
  probeKey(): ProbeKeyResult;
  encodeContent(content: ConversationContent): EncodeContentResult;
}

export interface CreateConversationDeps {
  store: ConversationStore;
  codec: CreateConversationCodec;
  teamReader: TeamEligibilityReader;
  /** Server time for `createdAt` and `updatedAt` (BR-2). Injected so tests can fix it. */
  clock: () => Date;
}

export interface CreateConversationInput {
  title: unknown;
  plannedFor?: unknown;
  teamId?: unknown;
}

export type CreateConversationResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: "invalid_input"; field: "title" | "plannedFor" | "teamId" }
  | { ok: false; error: "conversation_limit" | "persistence_failed" };

function defaultDeps(): CreateConversationDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey: probeKeyOnce, encodeContent: encodeContentWithKey },
    teamReader: createFirestoreTeamEligibilityReader(),
    clock: () => new Date(),
  };
}

/** Returns the team id, `null` when absent, or `undefined` when the value is not a valid team id. */
function parseTeamId(input: unknown): string | null | undefined {
  if (input === undefined || input === null) return null;
  return typeof input === "string" && isTeamIdSegment(input) ? input : undefined;
}

export async function createConversation(
  ownerUid: string,
  input: CreateConversationInput,
  deps: CreateConversationDeps = defaultDeps(),
): Promise<CreateConversationResult> {
  const title = normalizeTitle(input.title);
  if (!title.ok) return { ok: false, error: "invalid_input", field: "title" };

  const plannedFor = normalizePlannedFor(input.plannedFor);
  if (!plannedFor.ok) return { ok: false, error: "invalid_input", field: "plannedFor" };

  const teamId = parseTeamId(input.teamId);
  if (teamId === undefined) return { ok: false, error: "invalid_input", field: "teamId" };

  // BR-2 and BR-9: the owner must hold an active genuine membership of the team. A non-member, a disabled team and an
  // unknown team all read as `not_eligible`. Only a failed read is an operational failure.
  if (teamId !== null) {
    const access = await ownerCanInvite(ownerUid, teamId, deps.teamReader);
    if (!access.ok) {
      return access.error === "read_failed"
        ? { ok: false, error: "persistence_failed" }
        : { ok: false, error: "invalid_input", field: "teamId" };
    }
  }

  // BR-37: count-then-create. A count failure is operational, so nothing is written.
  let owned: number;
  try {
    owned = await deps.store.countOwner(ownerUid);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
  if (owned >= CONVERSATION_LIMIT) return { ok: false, error: "conversation_limit" };

  // BR-53: a key outage is checked before any write.
  if (!deps.codec.probeKey().ok) return { ok: false, error: "persistence_failed" };

  const content: ConversationContent = {
    title: title.text,
    ownerNotes: "",
    nextSteps: [],
    participantNotes: "",
    sharedGoals: [],
  };
  const encoded = deps.codec.encodeContent(content);
  if (!encoded.ok) return { ok: false, error: "persistence_failed" };

  const now = deps.clock();
  try {
    const conversationId = deps.store.newOwnerId(ownerUid);
    await deps.store.runTransaction(async (tx) => {
      tx.createOwner(ownerUid, conversationId, {
        teamId,
        participantUid: null,
        participantMemberRef: null,
        participantState: null,
        participantInvitedAt: null,
        participantAcceptedAt: null,
        plannedFor: plannedFor.value,
        status: "open",
        completedAt: null,
        createdAt: now,
        updatedAt: new Date(now.getTime()),
        ...encoded.content,
      });
    });
    return { ok: true, conversationId };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

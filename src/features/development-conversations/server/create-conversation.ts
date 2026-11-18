import "server-only";
import { CONVERSATION_LIMIT } from "../domain/conversation-constants";
import { parseConversationContent, type ConversationContent } from "../domain/content-payload";
import type { StoredEnvelope } from "../domain/stored-owner-conversation";
import { normalizePlannedFor } from "../domain/plan-date";
import { normalizeTitle } from "../domain/text-rules";
import { decodeContent, encodeContent as encodeContentWithKey, probeKey as probeKeyOnce } from "./content-codec";
import { conversationContext } from "../domain/stored-owner-conversation";
import type { EncodeContentResult, ProbeKeyResult } from "./content-codec";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";
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

/** Outcome of a create-only seed write: the owner conversation was created, or an identical one already existed. */
export type ConversationSeedAction = "create" | "skip";

/** Thrown when the stored owner conversation at the seed's id differs from the planned one, or cannot be opened. */
export class ConversationSeedConflictError extends Error {
  constructor() {
    super("conversation seed conflict");
    this.name = "ConversationSeedConflictError";
  }
}

export interface ConversationSeedInput {
  store: ConversationStore;
  ownerUid: string;
  /** Stable fixture id (a valid conversation id). The codec binds the content to it by AAD. */
  conversationId: string;
  content: ConversationContent;
  plannedFor: string | null;
  stamps: { createdAt: Date; updatedAt: Date };
}

/**
 * Trusted create-only seed of one owner-only conversation (feature-owned; reached only from the trusted seed workflow).
 * The owner document is sealed with the same codec and `dev-conversation:<uid>:<id>` AAD as `createConversation`, carries
 * the same canonical key set, and writes no participation index: an owner-only conversation has no participant. The write
 * runs in the owner transaction (erasure-fenced). An identical existing document is skipped; any other is a conflict.
 */
export async function seedOwnerConversationCreateOnly(input: ConversationSeedInput): Promise<ConversationSeedAction> {
  const { store, ownerUid, conversationId, content, plannedFor, stamps } = input;
  const checked = parseConversationContent(content);
  if (!checked.ok) throw new ConversationSeedConflictError();
  const planned = {
    teamId: null,
    participantUid: null,
    participantMemberRef: null,
    participantState: null,
    participantInvitedAt: null,
    participantAcceptedAt: null,
    plannedFor,
    status: "open" as const,
    completedAt: null,
    createdAt: stamps.createdAt,
    updatedAt: stamps.updatedAt,
  };

  return store.runOwnerTransaction(ownerUid, async (tx) => {
    const existing = await tx.getOwner(ownerUid, conversationId);
    if (existing === undefined) {
      if (!probeKeyOnce().ok) throw new Error("conversation seed key unavailable");
      const encoded = encodeContentWithKey(content, conversationContext(ownerUid, conversationId));
      if (!encoded.ok) throw new Error("conversation seed key unavailable");
      tx.createOwner(ownerUid, conversationId, { ...planned, ...encoded.content });
      return "create";
    }
    if (!sameOwnerConversation(existing, planned, content, conversationContext(ownerUid, conversationId))) {
      throw new ConversationSeedConflictError();
    }
    return "skip";
  });
}

const PLAIN_OWNER_KEYS = [
  "teamId",
  "participantUid",
  "participantMemberRef",
  "participantState",
  "participantInvitedAt",
  "participantAcceptedAt",
  "plannedFor",
  "status",
  "completedAt",
  "createdAt",
  "updatedAt",
] as const;

/** Plain fields equal, and the sealed content opens under the same AAD to the planned content. */
function sameOwnerConversation(
  stored: Record<string, unknown>,
  planned: Record<(typeof PLAIN_OWNER_KEYS)[number], unknown>,
  content: ConversationContent,
  context: string,
): boolean {
  const plainSame = PLAIN_OWNER_KEYS.every((key) => {
    const a = stored[key];
    const b = planned[key];
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return a === b || (a === undefined && b === null);
  });
  if (!plainSame) return false;
  const envelope = {
    ciphertext: stored.ciphertext,
    iv: stored.iv,
    authTag: stored.authTag,
    keyVersion: stored.keyVersion,
    keyId: stored.keyId,
    keyCheck: stored.keyCheck,
  };
  if (!isStoredEnvelope(envelope)) return false;
  const opened = decodeContent(envelope, context);
  if (!opened.ok) return false;
  return canonicalContent(opened.content) === canonicalContent(content);
}

/** Key-order-independent JSON of a conversation payload, so equal content compares equal regardless of field order. */
function canonicalContent(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

function isStoredEnvelope(value: { [key: string]: unknown }): value is StoredEnvelope {
  return (
    typeof value.ciphertext === "string" &&
    typeof value.iv === "string" &&
    typeof value.authTag === "string" &&
    value.keyVersion === "v2" &&
    value.keyId === "k1" &&
    typeof value.keyCheck === "string"
  );
}

/** The only codec operations create needs. The real codec module and the test fake both satisfy it. */
export interface CreateConversationCodec {
  probeKey(): ProbeKeyResult;
  encodeContent(content: ConversationContent, context: string): EncodeContentResult;
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
  | { ok: false; error: "conversation_limit" | "erasure_in_progress" | "persistence_failed" };

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
    sharedEvidence: [],
  };
  // The id is reserved before sealing, because the content is bound to this document by AAD.
  let conversationId: string;
  try {
    conversationId = deps.store.newOwnerId(ownerUid);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
  const encoded = deps.codec.encodeContent(content, conversationContext(ownerUid, conversationId));
  if (!encoded.ok) return { ok: false, error: "persistence_failed" };

  const now = deps.clock();
  try {
    await deps.store.runOwnerTransaction(ownerUid, async (tx) => {
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
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

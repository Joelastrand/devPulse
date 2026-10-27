import "server-only";
import { READ_WINDOW } from "../domain/conversation-constants";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationStatus } from "../domain/conversation-status";
import { STORED_KEY_VERSION } from "../domain/stored-owner-conversation";
import type { TeamEligibilityReader } from "./team-eligibility";

/**
 * Persistence contract for D2 conversations (TASK-005; SPEC AD-2, BR-33, BR-34, BR-36, BR-37, BR-48). Pure types, path
 * helpers and the canonical write shapes, shared by the Admin SDK store and the in-memory fake. Imports no Firebase, so
 * the fake stays Firebase-free.
 *
 * This is the only production file that writes the protected storage identifiers as literals. The two subtrees are
 * `userDevelopment/{ownerUid}/conversations/{conversationId}` (owner, authoritative) and
 * `userDevelopment/{participantUid}/conversationParticipations/{conversationId}` (locator-only index, grants nothing).
 *
 * The store is a persistence boundary only. It returns raw material and never validates, classifies, repairs,
 * authorizes or maps errors. Parsing belongs to the TASK-002 parsers, and classification to the operations.
 */

/** The parent of both subtrees (AD-2). */
export const USER_DEVELOPMENT_COLLECTION = "userDevelopment";
/** The owner subtree: authoritative conversation documents (AD-2, CL-13). */
export const OWNER_CONVERSATIONS_SUBCOLLECTION = "conversations";
/** The participant subtree: locator-only index documents (AD-2). */
export const PARTICIPATION_INDEX_SUBCOLLECTION = "conversationParticipations";

/** Size of each bounded raw read: the window plus one truncation probe (BR-33, BR-34, BR-36). */
export const CONVERSATION_RAW_READ_LIMIT = READ_WINDOW + 1;

/** A path segment the store refuses to build a document path from. Carries no id, uid or content. */
export class InvalidConversationStoreKeyError extends Error {
  constructor() {
    super("invalid conversation store key");
    this.name = "InvalidConversationStoreKeyError";
  }
}

/** A uid segment: non-empty, no `/`, not `.` or `..`, and not of the reserved `__…__` form. Same rule as D1. */
export function assertUidSegment(uid: unknown): asserts uid is string {
  const ok =
    typeof uid === "string" && uid.length > 0 && !uid.includes("/") && uid !== "." && uid !== ".." && !/^__.*__$/.test(uid);
  if (!ok) throw new InvalidConversationStoreKeyError();
}

/** A conversation id segment: the domain rule (TASK-001, 1–128 characters, `[A-Za-z0-9_-]`, no `__`). */
export function assertConversationIdSegment(id: unknown): asserts id is string {
  if (!isConversationId(id)) throw new InvalidConversationStoreKeyError();
}

/** Owner document path segments: `[userDevelopment, ownerUid, conversations, conversationId]`. */
export function ownerDocumentPath(ownerUid: string, conversationId: string): readonly string[] {
  assertUidSegment(ownerUid);
  assertConversationIdSegment(conversationId);
  return [USER_DEVELOPMENT_COLLECTION, ownerUid, OWNER_CONVERSATIONS_SUBCOLLECTION, conversationId];
}

/** Participant index path segments: `[userDevelopment, participantUid, conversationParticipations, conversationId]`. */
export function participationDocumentPath(callerUid: string, conversationId: string): readonly string[] {
  assertUidSegment(callerUid);
  assertConversationIdSegment(conversationId);
  return [USER_DEVELOPMENT_COLLECTION, callerUid, PARTICIPATION_INDEX_SUBCOLLECTION, conversationId];
}

/** Canonical owner document keys (TASK-002, BR-51). Sixteen, `keyCheck` included, and no conversationId field. */
export const OWNER_DOCUMENT_KEYS = [
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
  "ciphertext",
  "iv",
  "authTag",
  "keyVersion",
  "keyCheck",
] as const;

/** Canonical participant index keys (TASK-002). Locator only. */
export const PARTICIPATION_INDEX_KEYS = ["ownerUid", "invitedAt"] as const;

/**
 * The owner document as written. The envelope fields are flat, exactly as the codec returns them (`keyCheck` is the
 * sixteenth key, BR-51, CL-27). The store never computes, compares or repairs `keyCheck`.
 */
export interface OwnerDocumentWrite {
  teamId: string | null;
  participantUid: string | null;
  participantMemberRef: string | null;
  participantState: "pending" | "accepted" | null;
  participantInvitedAt: Date | null;
  participantAcceptedAt: Date | null;
  plannedFor: string | null;
  status: ConversationStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: typeof STORED_KEY_VERSION;
  keyCheck: string;
}

/** Partial owner write, for `updateOwner`. Only the canonical keys are ever written. `null` clears a value. */
export type OwnerDocumentPatch = Partial<OwnerDocumentWrite>;

/** The participant index as written: exactly the two canonical keys. */
export interface ParticipationIndexWrite {
  ownerUid: string;
  invitedAt: Date;
}

/** Raw stored data with top-level Firestore `Timestamp`s mapped to `Date`. Never validated. */
export type RawConversationData = Record<string, unknown>;

export interface RawConversationDoc {
  id: string;
  data: RawConversationData;
}

/**
 * Result of a bounded list query. `docs` is the window, at most `READ_WINDOW` documents in query order. The probe
 * document is never returned. `rawCount` is what the query returned, at most `CONVERSATION_RAW_READ_LIMIT`.
 */
export interface RawConversationWindow {
  docs: RawConversationDoc[];
  rawCount: number;
}

/**
 * Result of the `createdAt`-presence scan (BR-33). `missingCreatedAtIds` are ids within the first `READ_WINDOW` raw
 * documents whose `createdAt` is absent. No other stored field is read.
 */
export interface MissingCreatedAtScan {
  missingCreatedAtIds: string[];
  rawCount: number;
}

/**
 * One transaction across both subtrees (BR-48). Every read must precede every write, as in Firestore. Writes are
 * buffered and applied together, or not at all.
 */
export interface ConversationTransaction {
  /**
   * The TASK-006 team and membership point reads, performed inside this transaction (BR-48). A participant write decides
   * eligibility from these reads only, never from a read made outside the transaction. Raw data only; no decision here.
   */
  readonly teamEligibility: TeamEligibilityReader;
  getOwner(ownerUid: string, conversationId: string): Promise<RawConversationData | undefined>;
  /** Creates the owner document. Fails if it exists (no overwrite). */
  createOwner(ownerUid: string, conversationId: string, doc: OwnerDocumentWrite): void;
  /** Replaces the owner document with the canonical keys of `doc`. */
  setOwner(ownerUid: string, conversationId: string, doc: OwnerDocumentWrite): void;
  /** Updates only the given canonical keys. Fails if the document does not exist (no create). */
  updateOwner(ownerUid: string, conversationId: string, patch: OwnerDocumentPatch): void;
  deleteOwner(ownerUid: string, conversationId: string): void;
  getParticipation(callerUid: string, conversationId: string): Promise<RawConversationData | undefined>;
  /** Replaces the participant index document with the canonical keys of `index`. */
  setParticipation(callerUid: string, conversationId: string, index: ParticipationIndexWrite): void;
  deleteParticipation(callerUid: string, conversationId: string): void;
}

/**
 * The conversation store. Each method takes the verified uid of the caller (owner or participant) as its first
 * argument. There is no query across owners, and no group-wide query. Every read is a point read or a bounded query.
 */
export interface ConversationStore {
  /** A new, valid conversation id in the owner's subtree. Allocation only, no write. */
  newOwnerId(ownerUid: string): string;
  /** `orderBy createdAt desc`, `limit(READ_WINDOW + 1)` (BR-33). Documents without `createdAt` are not in this window. */
  listOwnerWindow(ownerUid: string): Promise<RawConversationWindow>;
  /** `select createdAt`, `limit(READ_WINDOW + 1)`, no `orderBy` (BR-33 recovery scan). */
  scanOwnerMissingCreatedAt(ownerUid: string): Promise<MissingCreatedAtScan>;
  /** `count()` over the owner subtree, malformed documents included (BR-37). */
  countOwner(ownerUid: string): Promise<number>;
  /** Point read. `undefined` when absent. A read failure rejects and is never reported as absence. */
  getOwner(ownerUid: string, conversationId: string): Promise<RawConversationData | undefined>;
  /** `orderBy invitedAt desc`, `limit(READ_WINDOW + 1)` (BR-34). Index entries without `invitedAt` are not in this window. */
  listParticipationWindow(callerUid: string): Promise<RawConversationWindow>;
  /** `count()` over the caller's index subtree, any state (BR-37). */
  countParticipation(callerUid: string): Promise<number>;
  /** Point read of an index entry. Finding one grants no access (BR-21). */
  getParticipation(callerUid: string, conversationId: string): Promise<RawConversationData | undefined>;
  /** One Firestore transaction across both subtrees (BR-48). Firestore may re-run `work`. */
  runTransaction<T>(work: (tx: ConversationTransaction) => Promise<T>): Promise<T>;
}

/** The canonical owner record, built field by field from the write shape. Unknown input keys are dropped. */
export function toOwnerRecord(doc: OwnerDocumentWrite): Record<(typeof OWNER_DOCUMENT_KEYS)[number], unknown> {
  return {
    teamId: requireKey(doc, "teamId"),
    participantUid: requireKey(doc, "participantUid"),
    participantMemberRef: requireKey(doc, "participantMemberRef"),
    participantState: requireKey(doc, "participantState"),
    participantInvitedAt: requireKey(doc, "participantInvitedAt"),
    participantAcceptedAt: requireKey(doc, "participantAcceptedAt"),
    plannedFor: requireKey(doc, "plannedFor"),
    status: requireKey(doc, "status"),
    completedAt: requireKey(doc, "completedAt"),
    createdAt: requireKey(doc, "createdAt"),
    updatedAt: requireKey(doc, "updatedAt"),
    ciphertext: requireKey(doc, "ciphertext"),
    iv: requireKey(doc, "iv"),
    authTag: requireKey(doc, "authTag"),
    keyVersion: requireKey(doc, "keyVersion"),
    keyCheck: requireKey(doc, "keyCheck"),
  };
}

/** The canonical index record. Both keys must be present; nothing else is ever written. */
export function toParticipationRecord(index: ParticipationIndexWrite): Record<(typeof PARTICIPATION_INDEX_KEYS)[number], unknown> {
  return { ownerUid: requireKey(index, "ownerUid"), invitedAt: requireKey(index, "invitedAt") };
}

/**
 * The canonical keys a patch sets, in canonical order. An empty patch is a caller error on both implementations (the
 * Admin SDK rejects an empty update), so it is refused here rather than silently accepted by the fake.
 */
export function patchedOwnerKeys(patch: OwnerDocumentPatch): Array<(typeof OWNER_DOCUMENT_KEYS)[number]> {
  const keys = OWNER_DOCUMENT_KEYS.filter((key) => patch[key] !== undefined);
  if (keys.length === 0) throw new Error("owner patch sets no canonical key");
  return keys;
}

/** A canonical key that is missing or `undefined` is a programming error. It is never written as an absent value. */
function requireKey<T extends object, K extends keyof T>(source: T, key: K): T[K] {
  if (source[key] === undefined) throw new InvalidConversationStoreKeyError();
  return source[key];
}

import { parseConversationContent, type ConversationContent } from "./content-payload";
import { isConversationStatus, type ConversationStatus } from "./conversation-status";
import { isValidPlanDate } from "./plan-date";
import { hasExactKeys, isNonEmptyString, isPlainObject, isStoredDate } from "./stored-shape";

/**
 * Stored owner document (SPEC BR-51, AD-2): a document in the D2 owner subtree, keyed by owner uid and conversation id.
 * This is an internal D2 persistence shape only. It grants no access to personal-goal storage.
 *
 * The document holds exactly the sixteen plain keys below. Content is never a plain key: it lives in the single
 * encrypted payload (BR-51, BR-52). Every key is always written, so an optional value is `null`, never absent. A
 * missing or `undefined` key is malformed. The conversation id is the document path, so no id field is stored.
 *
 * This module never decrypts and never authorises. Decryption is a caller-supplied function that runs only after the
 * plain shape and the ciphertext envelope have passed, so a malformed document is never sent to the codec. An
 * exception from that function is not caught here. A key outage therefore cannot be classified as malformed data
 * (SPEC BR-53, IMPL-1). `keyCheck` is validated here for form only. Whether it matches the configured key is decided
 * by the codec (TASK-003) before authentication, and a mismatch is an operational failure, not a classification here
 * (SPEC BR-51, BR-53, CL-27).
 */
export const STORED_OWNER_PLAIN_KEYS = [
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

/**
 * The encrypted-payload format of `lib/encryption` (`KEY_VERSION`, AES-256-GCM, 12-byte IV, 16-byte tag). That module
 * is server-only and reads `process.env`, so the constant is repeated here. The codec (TASK-003) must keep them equal.
 */
export const STORED_KEY_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The fixed, domain-separated context for the `keyCheck` derivation (SPEC BR-51, CL-27). It is a constant of this
 * module, the single place it is defined. Only TASK-003 uses it, as the HMAC message. Changing it changes every
 * stored `keyCheck`, so it is versioned.
 */
export const KEY_CHECK_CONTEXT = "devpulse.d2.conversation-key-check.v1";

/** HMAC-SHA-256 output length. A stored `keyCheck` is exactly this many decoded bytes (BR-51). */
export const KEY_CHECK_BYTES = 32;

export type StoredEnvelope = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: typeof STORED_KEY_VERSION;
  /**
   * Plaintext, non-secret key-check metadata (BR-51). It is passed to the codec with the envelope so the codec can
   * compare it with the configured key before authentication. It is not part of the valid record and never reaches
   * a DTO.
   */
  keyCheck: string;
};

export type StoredParticipant = {
  uid: string;
  memberRef: string;
  state: "pending" | "accepted";
  invitedAt: Date;
  /** Set exactly when `state` is `accepted` (BR-15). */
  acceptedAt: Date | null;
};

/** Internal representation of a valid owner document. It is never a public DTO (SPEC BR-41…BR-44, BR-46). */
export type StoredConversation = {
  teamId: string | null;
  participant: StoredParticipant | null;
  plannedFor: string | null;
  status: ConversationStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  content: ConversationContent;
};

/** Internal only. A reason is never returned to a client, so it cannot leak a field name or value (BR-33, D2-SI-13). */
export type MalformedReason =
  | "not_plain_object"
  | "keys"
  | "team"
  | "participant"
  | "planned_for"
  | "status"
  | "timestamps"
  | "envelope"
  | "key_check"
  | "payload";

/**
 * The caller's decryption result. A key outage is not representable here: it throws, and the caller reports it as
 * `persistence_failed` (BR-53). Decrypted `payload` is the parsed JSON value, not a string.
 */
export type DecryptOutcome = { status: "decrypted"; payload: unknown } | { status: "authentication_failed" };

export type StoredConversationClassification =
  | { kind: "valid"; record: StoredConversation }
  | { kind: "malformed"; reason: MalformedReason }
  | { kind: "unreadable_payload" };

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decoded byte length of a canonical padded base64 string, or `null` otherwise. Canonical means the encoder's output:
 * standard alphabet, padded to a multiple of four, and unused trailing bits zero. Node's decoder accepts non-zero
 * trailing bits (`QR==` and `QQ==` both decode to one zero byte), so those are rejected explicitly here.
 */
function base64ByteLength(value: string): number | null {
  if (!BASE64_PATTERN.test(value) || value.length % 4 !== 0) {
    return null;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const lastData = BASE64_ALPHABET.indexOf(value.charAt(value.length - padding - 1));
  if (padding === 2 && (lastData & 0x0f) !== 0) {
    return null;
  }
  if (padding === 1 && (lastData & 0x03) !== 0) {
    return null;
  }
  return (value.length / 4) * 3 - padding;
}

/** The envelope fields: the helper's format and lengths. Structural only, no decryption. */
function readEnvelope(raw: Record<string, unknown>): Omit<StoredEnvelope, "keyCheck"> | null {
  const { ciphertext, iv, authTag, keyVersion } = raw;
  if (keyVersion !== STORED_KEY_VERSION || typeof ciphertext !== "string" || typeof iv !== "string") {
    return null;
  }
  if (typeof authTag !== "string") {
    return null;
  }
  const ciphertextBytes = base64ByteLength(ciphertext);
  if (ciphertextBytes === null || ciphertextBytes === 0) {
    return null;
  }
  if (base64ByteLength(iv) !== IV_BYTES || base64ByteLength(authTag) !== AUTH_TAG_BYTES) {
    return null;
  }
  return { ciphertext, iv, authTag, keyVersion: STORED_KEY_VERSION };
}

/**
 * The stored `keyCheck` form only: canonical base64 of exactly `KEY_CHECK_BYTES` bytes. It is never compared with
 * a key here. A structurally valid value is accepted as stored metadata; the comparison is TASK-003's (CL-27).
 */
function readKeyCheck(value: unknown): string | null {
  if (typeof value !== "string" || base64ByteLength(value) !== KEY_CHECK_BYTES) {
    return null;
  }
  return value;
}

type ParticipantResult = { ok: true; participant: StoredParticipant | null } | { ok: false };

/**
 * The participant binding is all-null (no participant) or all-set (BR-7, BR-10). `acceptedAt` is set exactly when
 * the state is `accepted`. `memberRef` is stored for later equality checks only and grants nothing here (CL-23).
 */
function parseParticipant(raw: Record<string, unknown>): ParticipantResult {
  const { participantUid, participantMemberRef, participantState, participantInvitedAt, participantAcceptedAt } = raw;
  if (participantUid === null) {
    const absent =
      participantMemberRef === null &&
      participantState === null &&
      participantInvitedAt === null &&
      participantAcceptedAt === null;
    return absent ? { ok: true, participant: null } : { ok: false };
  }
  if (!isNonEmptyString(participantUid) || !isNonEmptyString(participantMemberRef)) {
    return { ok: false };
  }
  if (participantState !== "pending" && participantState !== "accepted") {
    return { ok: false };
  }
  if (!isStoredDate(participantInvitedAt)) {
    return { ok: false };
  }
  let acceptedAt: Date | null = null;
  if (participantState === "accepted") {
    if (!isStoredDate(participantAcceptedAt)) {
      return { ok: false };
    }
    acceptedAt = participantAcceptedAt;
  } else if (participantAcceptedAt !== null) {
    return { ok: false };
  }
  return {
    ok: true,
    participant: {
      uid: participantUid,
      memberRef: participantMemberRef,
      state: participantState,
      invitedAt: participantInvitedAt,
      acceptedAt,
    },
  };
}

function optionalNonEmptyString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return isNonEmptyString(value) ? value : undefined;
}

function optionalPlanDate(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return isValidPlanDate(value) ? value : undefined;
}

type ShapeResult =
  | { ok: true; record: Omit<StoredConversation, "content">; envelope: StoredEnvelope }
  | { ok: false; reason: MalformedReason };

/** Plain fields, binding, status and timestamps, and the envelope. Runs before any decryption. */
function parseOwnerShape(raw: unknown): ShapeResult {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: "not_plain_object" };
  }
  if (!hasExactKeys(raw, STORED_OWNER_PLAIN_KEYS)) {
    return { ok: false, reason: "keys" };
  }
  const { teamId, plannedFor, status, completedAt, createdAt, updatedAt } = raw;

  const teamIdValue = optionalNonEmptyString(teamId);
  if (teamIdValue === undefined) {
    return { ok: false, reason: "team" };
  }

  if (!isConversationStatus(status)) {
    return { ok: false, reason: "status" };
  }

  const binding = parseParticipant(raw);
  if (!binding.ok) {
    return { ok: false, reason: "participant" };
  }
  // A conversation without a team can never have a participant (BR-2).
  if (binding.participant !== null && teamIdValue === null) {
    return { ok: false, reason: "participant" };
  }
  // Completion withdraws any pending invitation in the same transaction (BR-13, CL-25). No valid operation can
  // produce a completed conversation with a pending participant, so it is not a canonical state.
  if (status === "completed" && binding.participant?.state === "pending") {
    return { ok: false, reason: "participant" };
  }

  const plannedForValue = optionalPlanDate(plannedFor);
  if (plannedForValue === undefined) {
    return { ok: false, reason: "planned_for" };
  }

  if (!isStoredDate(createdAt) || !isStoredDate(updatedAt)) {
    return { ok: false, reason: "timestamps" };
  }

  // `completedAt` is present exactly when the conversation is completed (BR-4, BR-28). Reopening does not exist.
  let completedAtValue: Date | null = null;
  if (status === "completed") {
    if (!isStoredDate(completedAt)) {
      return { ok: false, reason: "timestamps" };
    }
    completedAtValue = completedAt;
  } else if (completedAt !== null) {
    return { ok: false, reason: "timestamps" };
  }

  const envelope = readEnvelope(raw);
  if (envelope === null) {
    return { ok: false, reason: "envelope" };
  }

  const keyCheck = readKeyCheck(raw.keyCheck);
  if (keyCheck === null) {
    return { ok: false, reason: "key_check" };
  }

  return {
    ok: true,
    envelope: { ...envelope, keyCheck },
    record: {
      teamId: teamIdValue,
      participant: binding.participant,
      plannedFor: plannedForValue,
      status,
      completedAt: completedAtValue,
      createdAt,
      updatedAt,
    },
  };
}

/**
 * Classifies one stored owner document. The order is fixed: plain shape and envelope first (no decryption), then the
 * caller's decryption, then the decrypted payload. Malformed content is never repaired. Every result is content-free.
 */
export function classifyStoredConversation(
  raw: unknown,
  decrypt: (envelope: StoredEnvelope) => DecryptOutcome,
): StoredConversationClassification {
  const shape = parseOwnerShape(raw);
  if (!shape.ok) {
    return { kind: "malformed", reason: shape.reason };
  }
  const outcome = decrypt(shape.envelope);
  if (outcome.status === "authentication_failed") {
    return { kind: "unreadable_payload" };
  }
  const content = parseConversationContent(outcome.payload);
  if (!content.ok) {
    return { kind: "malformed", reason: "payload" };
  }
  return { kind: "valid", record: { ...shape.record, content: content.content } };
}

/**
 * Plain-shape classification only (TASK-015). Checks the plain fields and the envelope structure, and never decrypts.
 * Use it only where the result does not need the content: the pending view depends on the plain fields alone, so it
 * must not depend on the key (BR-53). The full classification above is still required for any content read or write.
 */
export function classifyStoredShape(
  raw: unknown,
): { kind: "valid"; record: Omit<StoredConversation, "content"> } | { kind: "malformed"; reason: MalformedReason } {
  const shape = parseOwnerShape(raw);
  return shape.ok ? { kind: "valid", record: shape.record } : { kind: "malformed", reason: shape.reason };
}

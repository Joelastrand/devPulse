import "server-only";
import {
  checkRecordKeyCheck,
  decryptRecord,
  encryptRecord,
  RecordEnvelopeError,
  recordKeyCheck,
  type RecordEnvelope,
} from "../../../lib/encryption/record-envelope";
import { parseConversationContent, type ConversationContent } from "../domain/content-payload";
import { serializeSharedEvidenceSnapshot } from "../domain/shared-evidence-snapshot";
import {
  STORED_KEY_ID,
  STORED_KEY_VERSION,
  type DecryptOutcome,
  type StoredEnvelope,
} from "../domain/stored-owner-conversation";

/**
 * The single D2 seam over the record envelope v2 (`src/lib/encryption/record-envelope.ts`). Every D2 encrypt and decrypt
 * goes through this module. Each record is sealed with AAD `dev-conversation:<ownerUid>:<conversationId>`, which the caller
 * passes in, so a ciphertext cannot be moved to another owner's or another conversation's document.
 *
 * The stored `keyCheck` is kept next to the envelope so a wrong key is reported as `key_mismatch` before any decryption. A
 * wrong key and a tampered value are different failures and must stay different (SPEC BR-51, BR-53, CL-27). Failures are
 * typed and content-free: no key, keyCheck, ciphertext, IV or helper message ever appears in a result or a thrown error.
 */

/** The stored envelope: `{ ciphertext, iv, authTag, keyVersion, keyId, keyCheck }`. */
export type EncryptedContent = StoredEnvelope;

/**
 * Operational key failures. Both map to `persistence_failed` (BR-53). Neither is a recovery item, and neither may
 * reach `classifyStoredConversation` as malformed or `authentication_failed`.
 */
export type KeyFailure = "key_unavailable" | "key_mismatch";

/** Decode failures. Only `payload_unauthenticated` may become `authentication_failed` for the classifier. */
export type ContentCodecFailure = KeyFailure | "payload_unauthenticated" | "malformed_payload";

export type ProbeKeyResult = { ok: true } | { ok: false; error: "key_unavailable" };
export type EncodeContentResult = { ok: true; content: EncryptedContent } | { ok: false; error: "key_unavailable" };
export type DecodeContentResult = { ok: true; content: ConversationContent } | { ok: false; error: ContentCodecFailure };

/**
 * Thrown by `decryptForClassification` for `key_unavailable` and `key_mismatch`, so the classifier never sees them.
 * The message is the stable code only.
 */
export class ContentKeyError extends Error {
  readonly code: KeyFailure;

  constructor(code: KeyFailure) {
    super(code);
    this.name = "ContentKeyError";
    this.code = code;
  }
}

/** Fixed, non-secret input and context for the BR-53 probe. Its output is discarded. */
const PROBE_PLAINTEXT = "devpulse.d2.key-probe";
const PROBE_CONTEXT = "devpulse.d2.key-probe";

/**
 * The plaintext JSON object, with a fixed key order and the exact D2 content fields. `capturedAt` is written as a
 * canonical ISO string, the form the payload parser reads back.
 */
function serializeContent(content: ConversationContent): unknown {
  return {
    title: content.title,
    ownerNotes: content.ownerNotes,
    nextSteps: content.nextSteps,
    participantNotes: content.participantNotes,
    sharedGoals: content.sharedGoals.map((goal) => ({
      goalTitle: goal.goalTitle,
      treeId: goal.treeId,
      targetDate: goal.targetDate,
      status: goal.status,
      capturedAt: goal.capturedAt.toISOString(),
    })),
    // Every successful write serializes payload v2, so `sharedEvidence` is present, possibly empty.
    sharedEvidence: content.sharedEvidence.map(serializeSharedEvidenceSnapshot),
  };
}

/** BR-53 probe: confirms the key is readable and usable, then makes one envelope and discards it. */
export function probeKey(): ProbeKeyResult {
  try {
    recordKeyCheck();
    encryptRecord(PROBE_PLAINTEXT, PROBE_CONTEXT);
    return { ok: true };
  } catch {
    return { ok: false, error: "key_unavailable" };
  }
}

/**
 * Encrypts validated content for the record identified by `context` (`conversationContext(ownerUid, conversationId)`).
 * The keyCheck is derived from the same configured key as the record subkey, so the stored check and the ciphertext
 * always agree.
 */
export function encodeContent(content: ConversationContent, context: string): EncodeContentResult {
  let keyCheck: string;
  let encrypted: RecordEnvelope;
  try {
    keyCheck = recordKeyCheck();
    encrypted = encryptRecord(JSON.stringify(serializeContent(content)), context);
  } catch {
    return { ok: false, error: "key_unavailable" };
  }
  return {
    ok: true,
    content: {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: STORED_KEY_VERSION,
      keyId: STORED_KEY_ID,
      keyCheck,
    },
  };
}

type OpenResult = { ok: true; json: unknown } | { ok: false; error: ContentCodecFailure };

/**
 * Steps of the decode order, with no payload validation: key, keyCheck, authenticated decryption, JSON. The envelope has
 * already passed the structural checks in `stored-owner-conversation.ts`.
 */
function openEnvelope(envelope: StoredEnvelope, context: string): OpenResult {
  // The keyCheck is compared before any decryption. A mismatch means the record belongs to a different key, not that it
  // was tampered with, so it is never reported as an authentication failure.
  const keyStatus = checkRecordKeyCheck(envelope.keyCheck);
  if (keyStatus === "key_unavailable") return { ok: false, error: "key_unavailable" };
  if (keyStatus === "key_mismatch") return { ok: false, error: "key_mismatch" };
  if (keyStatus === "malformed") return { ok: false, error: "malformed_payload" };

  let text: string;
  try {
    text = decryptRecord(
      { ciphertext: envelope.ciphertext, iv: envelope.iv, authTag: envelope.authTag, keyVersion: "v2", keyId: "k1" },
      context,
    );
  } catch (error) {
    if (!(error instanceof RecordEnvelopeError)) {
      // Any other throw is an unexpected runtime failure. It is neither a payload failure nor a recovery item.
      throw new Error("Unexpected content decryption failure.");
    }
    switch (error.code) {
      case "authentication_failed":
        return { ok: false, error: "payload_unauthenticated" };
      case "key_unavailable":
        return { ok: false, error: "key_unavailable" };
      case "unknown_key_id":
        return { ok: false, error: "key_mismatch" };
      case "malformed":
        return { ok: false, error: "malformed_payload" };
    }
  }

  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, error: "malformed_payload" };
  }
}

/**
 * Decrypts and validates one stored envelope with the payload parser. Every failure is typed and content-free.
 */
export function decodeContent(envelope: StoredEnvelope, context: string): DecodeContentResult {
  const opened = openEnvelope(envelope, context);
  if (!opened.ok) {
    return opened;
  }
  const parsed = parseConversationContent(opened.json);
  if (!parsed.ok) {
    return { ok: false, error: "malformed_payload" };
  }
  return { ok: true, content: parsed.content };
}

/**
 * The decrypt seam for `classifyStoredConversation`. A key failure throws `ContentKeyError`, so the classifier never
 * sees it. Only `payload_unauthenticated` returns `authentication_failed`. A malformed plaintext returns a `null`
 * payload, which the payload parser rejects as malformed. It is never reported as an authentication failure.
 */
export function decryptForClassification(envelope: StoredEnvelope, context: string): DecryptOutcome {
  const opened = openEnvelope(envelope, context);
  if (opened.ok) {
    return { status: "decrypted", payload: opened.json };
  }
  if (opened.error === "key_unavailable" || opened.error === "key_mismatch") {
    throw new ContentKeyError(opened.error);
  }
  if (opened.error === "payload_unauthenticated") {
    return { status: "authentication_failed" };
  }
  return { status: "decrypted", payload: null };
}

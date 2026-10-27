import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  decryptToBytes,
  EncryptedPayloadAuthenticationError,
  encrypt,
  readEncryptionKeyBytes,
  type EncryptedPayload,
} from "../../../lib/encryption/encryption";
import { parseConversationContent, type ConversationContent } from "../domain/content-payload";
import {
  KEY_CHECK_BYTES,
  KEY_CHECK_CONTEXT,
  STORED_KEY_VERSION,
  type DecryptOutcome,
  type StoredEnvelope,
} from "../domain/stored-owner-conversation";

/**
 * The single D2 seam over the existing AES-256-GCM helper (SPEC BR-51, BR-53, CL-27, AD-5). Every D2 encrypt and
 * decrypt goes through this module. It reads `ENCRYPTION_KEY` only through the helper's key accessor, so there is one
 * source of truth for key parsing. Failures are typed and content-free: no key, keyCheck, ciphertext, IV or helper
 * message ever appears in a result or a thrown error.
 */

/** The stored envelope: `{ ciphertext, iv, authTag, keyVersion, keyCheck }` (CL-27). */
export type EncryptedContent = StoredEnvelope;

/**
 * Operational key failures. Both map to `persistence_failed` (BR-53). Neither is a recovery item, and neither may
 * reach `classifyStoredConversation` as malformed or `authentication_failed`.
 */
export type KeyFailure = "key_unavailable" | "key_mismatch";

/** Decode failures. Only `payload_unauthenticated` may become `authentication_failed` for the TASK-002 classifier. */
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

/** Fixed, non-secret input for the BR-53 probe. Its output is discarded. */
const PROBE_PLAINTEXT = "devpulse.d2.key-probe";

/** Strict UTF-8: malformed bytes throw instead of becoming U+FFFD. A BOM is kept, so JSON.parse rejects it. */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * CL-27 / BR-51: HMAC-SHA-256 keyed with the validated 32-byte `ENCRYPTION_KEY` over the UTF-8 bytes of
 * `KEY_CHECK_CONTEXT`. The derivation is deterministic and domain-separated by the context.
 */
export function deriveKeyCheckBytes(keyBytes: Buffer): Buffer {
  return createHmac("sha256", keyBytes).update(KEY_CHECK_CONTEXT, "utf8").digest();
}

/**
 * The expected keyCheck for the configured key, or `null` when the key cannot be read or derived. The accessor is the
 * only call in the try block, so the classification is by location, not by inspecting the error message.
 */
function deriveExpectedKeyCheck(): Buffer | null {
  let expected: Buffer;
  try {
    expected = deriveKeyCheckBytes(readEncryptionKeyBytes());
  } catch {
    return null;
  }
  return expected.length === KEY_CHECK_BYTES ? expected : null;
}

/** BR-53 probe: confirms the key is readable and derivable, then makes one helper encryption and discards it. */
export function probeKey(): ProbeKeyResult {
  if (deriveExpectedKeyCheck() === null) {
    return { ok: false, error: "key_unavailable" };
  }
  try {
    encrypt(PROBE_PLAINTEXT);
    return { ok: true };
  } catch {
    return { ok: false, error: "key_unavailable" };
  }
}

/**
 * The plaintext JSON object, with a fixed key order and the exact D2 content fields. `capturedAt` is written as a
 * canonical ISO string, the form TASK-002's payload parser reads back.
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
  };
}

/**
 * Encrypts validated content. The keyCheck is derived from the helper key accessor. The helper's `encrypt` reads the
 * same variable through the same parser, so the AES key and the keyCheck key come from one source.
 */
export function encodeContent(content: ConversationContent): EncodeContentResult {
  const expectedKeyCheck = deriveExpectedKeyCheck();
  if (expectedKeyCheck === null) {
    return { ok: false, error: "key_unavailable" };
  }

  const plaintext = JSON.stringify(serializeContent(content));
  let encrypted: EncryptedPayload;
  try {
    encrypted = encrypt(plaintext);
  } catch {
    return { ok: false, error: "key_unavailable" };
  }
  if (encrypted.keyVersion !== STORED_KEY_VERSION) {
    throw new Error("Encryption helper key version does not match the D2 stored key version.");
  }

  return {
    ok: true,
    content: {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: STORED_KEY_VERSION,
      keyCheck: expectedKeyCheck.toString("base64"),
    },
  };
}

type OpenResult = { ok: true; json: unknown } | { ok: false; error: ContentCodecFailure };

/**
 * Steps 1 to 6 of the locked decode order, with no payload validation: key bytes, keyCheck, authenticated decrypt,
 * strict UTF-8, JSON parse. The envelope has already passed TASK-002's structural checks.
 */
function openEnvelope(envelope: StoredEnvelope): OpenResult {
  const expectedKeyCheck = deriveExpectedKeyCheck();
  if (expectedKeyCheck === null) {
    return { ok: false, error: "key_unavailable" };
  }

  // Length is checked first. `timingSafeEqual` throws on unequal lengths, and a length mismatch is key_mismatch.
  const storedKeyCheck = Buffer.from(envelope.keyCheck, "base64");
  if (storedKeyCheck.length !== expectedKeyCheck.length || !timingSafeEqual(storedKeyCheck, expectedKeyCheck)) {
    return { ok: false, error: "key_mismatch" };
  }

  let plaintext: Buffer;
  try {
    plaintext = decryptToBytes({
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      authTag: envelope.authTag,
      keyVersion: envelope.keyVersion,
    });
  } catch (error) {
    if (error instanceof EncryptedPayloadAuthenticationError) {
      return { ok: false, error: "payload_unauthenticated" };
    }
    // Any other throw is an unexpected runtime failure. It is neither a payload failure nor a recovery item.
    throw new Error("Unexpected content decryption failure.");
  }

  let text: string;
  try {
    text = STRICT_UTF8.decode(plaintext);
  } catch {
    return { ok: false, error: "malformed_payload" };
  }

  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, error: "malformed_payload" };
  }
}

/**
 * Decrypts and validates one stored envelope with the TASK-002 payload parser. Every failure is typed and content-free.
 */
export function decodeContent(envelope: StoredEnvelope): DecodeContentResult {
  const opened = openEnvelope(envelope);
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
 * payload, which the TASK-002 parser rejects as malformed. It is never reported as an authentication failure.
 */
export function decryptForClassification(envelope: StoredEnvelope): DecryptOutcome {
  const opened = openEnvelope(envelope);
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

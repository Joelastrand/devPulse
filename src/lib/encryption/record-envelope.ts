import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { readEncryptionKeyBytes } from "./encryption";

/**
 * Record envelope v2 (application-layer encryption for business content).
 *
 * - AES-256-GCM, a fresh random 12-byte IV per value, 16-byte auth tag.
 * - The AES key is an HKDF-SHA-256 subkey of the master `ENCRYPTION_KEY`, labelled with the key id. The master key is
 *   never used directly, so the record cipher is separated from every other use of the master key.
 * - The record context (for example `goal:<uid>:<goalId>`) is bound as GCM additional authenticated data. A ciphertext
 *   moved to another document, or another field of the same document, fails authentication.
 * - The envelope names its key id, so a later key can be introduced without re-encrypting all data at once.
 *
 * The context is never stored in the envelope; the reader rebuilds it from the document path. The v1 helper in
 * `encryption.ts` stays as it is for the features that already use it.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_CHECK_LABEL_PREFIX = "devpulse/record/v2/key-check/";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;
const SUBKEY_INFO_PREFIX = "devpulse/record/v2/";
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export const RECORD_ENVELOPE_VERSION = "v2" as const;

/** Key id of the key derived from `ENCRYPTION_KEY`. Add an entry here and in `keySourceFor` to introduce a new key. */
export const CURRENT_RECORD_KEY_ID = "k1" as const;

export interface RecordEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: typeof RECORD_ENVELOPE_VERSION;
  keyId: typeof CURRENT_RECORD_KEY_ID;
}

export type RecordEnvelopeFailure = "key_unavailable" | "unknown_key_id" | "authentication_failed" | "malformed";

/** Typed, content-free failure. The message is the stable code only. Never echoes key, IV, tag or ciphertext bytes. */
export class RecordEnvelopeError extends Error {
  readonly code: RecordEnvelopeFailure;

  constructor(code: RecordEnvelopeFailure) {
    super(code);
    this.name = "RecordEnvelopeError";
    this.code = code;
  }
}

/** Returns the master key bytes for a key id, or fails closed. Only the current id is known. */
function keySourceFor(keyId: string): () => Buffer {
  if (keyId === CURRENT_RECORD_KEY_ID) return readEncryptionKeyBytes;
  throw new RecordEnvelopeError("unknown_key_id");
}

/** HKDF-SHA-256 subkey for one key id. Fails closed when the master key is missing or unusable. */
function deriveRecordKey(keyId: string): Buffer {
  let master: Buffer;
  try {
    master = keySourceFor(keyId)();
  } catch (error) {
    if (error instanceof RecordEnvelopeError) throw error;
    throw new RecordEnvelopeError("key_unavailable");
  }
  if (master.length !== KEY_LENGTH_BYTES) throw new RecordEnvelopeError("key_unavailable");
  const subkey = hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from(SUBKEY_INFO_PREFIX + keyId, "utf8"), KEY_LENGTH_BYTES);
  return Buffer.from(subkey);
}

function assertContext(context: string): void {
  if (context.length === 0) throw new RecordEnvelopeError("malformed");
}

/** Encrypts `plaintext` for the record identified by `context`. Throws `RecordEnvelopeError` on any failure. */
export function encryptRecord(plaintext: string, context: string): RecordEnvelope {
  assertContext(context);
  const key = deriveRecordKey(CURRENT_RECORD_KEY_ID);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: RECORD_ENVELOPE_VERSION,
    keyId: CURRENT_RECORD_KEY_ID,
  };
}

/**
 * Structural check of an untrusted stored value. Returns the envelope, or `null` when it is not a v2 envelope.
 * Accepts only base64 strings with the expected sizes, so a malformed stored value never reaches the cipher.
 */
export function readRecordEnvelope(value: unknown): RecordEnvelope | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.keyVersion !== RECORD_ENVELOPE_VERSION || candidate.keyId !== CURRENT_RECORD_KEY_ID) return null;
  const { ciphertext, iv, authTag } = candidate;
  if (!isBase64(ciphertext) || !isBase64(iv) || !isBase64(authTag)) return null;
  if (Buffer.from(iv, "base64").length !== IV_LENGTH_BYTES) return null;
  if (Buffer.from(authTag, "base64").length !== 16) return null;
  return { ciphertext, iv, authTag, keyVersion: RECORD_ENVELOPE_VERSION, keyId: CURRENT_RECORD_KEY_ID };
}

/**
 * Decrypts and authenticates a v2 envelope against its record context. Throws `RecordEnvelopeError`:
 * `key_unavailable` / `unknown_key_id` for configuration problems, `authentication_failed` for any tampering, a wrong
 * context, or the wrong key, and `malformed` for a structurally invalid envelope.
 */
export function decryptRecord(envelope: RecordEnvelope, context: string): string {
  assertContext(context);
  const checked = readRecordEnvelope(envelope);
  if (checked === null) throw new RecordEnvelopeError("malformed");
  const key = deriveRecordKey(checked.keyId);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(checked.iv, "base64"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(checked.authTag, "base64"));
  try {
    const plain = Buffer.concat([
      decipher.update(Buffer.from(checked.ciphertext, "base64")),
      decipher.final(),
    ]);
    return STRICT_UTF8.decode(plain);
  } catch (error) {
    // Authentication failures stay apart from a valid tag over bytes that are not UTF-8 (`malformed`).
    if (error instanceof TypeError) throw new RecordEnvelopeError("malformed");
    throw new RecordEnvelopeError("authentication_failed");
  }
}

function isBase64(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && BASE64_PATTERN.test(value);
}

const KEY_CHECK_BYTES = 32;
/** Strict UTF-8: bytes that are not valid UTF-8 throw instead of becoming U+FFFD. */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Result of checking a stored key check against the configured key. The three failures stay apart because they mean
 * different things: `key_unavailable` is a configuration problem, `key_mismatch` means the stored data was written under a
 * different key, and `malformed` is a structurally invalid value. None of them is an authentication failure.
 */
export type RecordKeyCheckStatus = "ok" | "key_unavailable" | "key_mismatch" | "malformed";

/**
 * The key check of the configured key: base64 HMAC-SHA-256 over a fixed label, keyed with the record subkey. It identifies
 * the key without revealing it. A caller stores it next to the envelope, so a wrong key is reported as `key_mismatch`
 * before any decryption, and is never confused with tampering (which fails GCM authentication).
 */
export function recordKeyCheck(): string {
  const subkey = deriveRecordKey(CURRENT_RECORD_KEY_ID);
  return createHmac("sha256", subkey).update(KEY_CHECK_LABEL_PREFIX + CURRENT_RECORD_KEY_ID, "utf8").digest("base64");
}

/** Checks a stored key check against the configured key without decrypting anything. */
export function checkRecordKeyCheck(stored: unknown): RecordKeyCheckStatus {
  if (!isBase64(stored) || Buffer.from(stored, "base64").length !== KEY_CHECK_BYTES) return "malformed";
  let expected: Buffer;
  try {
    expected = Buffer.from(recordKeyCheck(), "base64");
  } catch {
    return "key_unavailable";
  }
  return timingSafeEqual(Buffer.from(stored, "base64"), expected) ? "ok" : "key_mismatch";
}

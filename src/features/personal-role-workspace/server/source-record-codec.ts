import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { decryptToBytes, encrypt, EncryptedPayloadAuthenticationError, readEncryptionKeyBytes, type EncryptedPayload } from "../../../lib/encryption/encryption";
import { SOURCE_KEY_CHECK_BYTES, SOURCE_KEY_CHECK_CONTEXT, SOURCE_KEY_VERSION } from "../domain/constants";

/**
 * The source-record codec (SECURITY.md PR-SI-5, SECURITY-REVIEW §11.1). It is the only code that encrypts or decrypts a
 * responsibility or achievement. It uses the shared AES-256-GCM helper and reads the key only through the helper's parser.
 *
 * Failure classes are returned as data, never thrown, so the caller can keep them apart:
 * - `key_unavailable`: configuration missing or invalid (class B).
 * - `key_mismatch`: the stored `keyCheck` differs from the configured key (class C). Checked before any decryption.
 * - `payload_unauthenticated`: the GCM tag failed although the key matched (class D: corruption or tampering).
 * - `malformed`: the envelope or the plaintext is structurally invalid (class E, decided by the caller for the plaintext).
 * Only `malformed` may ever become a deletable item. The other three never do.
 */

export interface SourceEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: typeof SOURCE_KEY_VERSION;
  keyCheck: string;
}

export type SourceCodecFailure = "key_unavailable" | "key_mismatch" | "payload_unauthenticated" | "malformed";

export type SourceEncodeResult = { ok: true; envelope: SourceEnvelope } | { ok: false; error: "key_unavailable" };
export type SourceDecodeResult = { ok: true; json: unknown } | { ok: false; error: SourceCodecFailure };
export type SourceKeyResult = { ok: true; keyCheck: Buffer } | { ok: false; error: "key_unavailable" };

const KEY_CHECK_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The expected `keyCheck` of the configured key: HMAC-SHA-256 over the source-record context (CL-27 construction). */
export function configuredKeyCheck(): SourceKeyResult {
  let key: Buffer;
  try {
    key = readEncryptionKeyBytes();
  } catch {
    return { ok: false, error: "key_unavailable" };
  }
  const check = createHmac("sha256", key).update(SOURCE_KEY_CHECK_CONTEXT, "utf8").digest();
  return check.length === SOURCE_KEY_CHECK_BYTES ? { ok: true, keyCheck: check } : { ok: false, error: "key_unavailable" };
}

/** Encrypts the JSON form of a validated payload. The plaintext never leaves this function unencrypted. */
export function encodeSourceRecord(payload: Record<string, unknown>): SourceEncodeResult {
  const key = configuredKeyCheck();
  if (!key.ok) return key;
  let encrypted: EncryptedPayload;
  try {
    encrypted = encrypt(JSON.stringify(payload));
  } catch {
    return { ok: false, error: "key_unavailable" };
  }
  return {
    ok: true,
    envelope: {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: SOURCE_KEY_VERSION,
      keyCheck: key.keyCheck.toString("base64"),
    },
  };
}

/** The envelope fields of a stored document, or `null` when the structure is not a valid envelope. Strings only. */
export function readEnvelope(data: Record<string, unknown>): SourceEnvelope | null {
  const { ciphertext, iv, authTag, keyVersion, keyCheck } = data;
  if (keyVersion !== SOURCE_KEY_VERSION) return null;
  if (!isBase64(ciphertext) || !isBase64(iv) || !isBase64(authTag)) return null;
  if (typeof keyCheck !== "string" || !KEY_CHECK_BASE64.test(keyCheck)) return null;
  if (Buffer.from(keyCheck, "base64").length !== SOURCE_KEY_CHECK_BYTES) return null;
  return { ciphertext, iv, authTag, keyVersion: SOURCE_KEY_VERSION, keyCheck };
}

/**
 * Checks the stored `keyCheck` against the configured key without decrypting anything. Used before any write on an owner's
 * existing records, so a key change can never produce a mixed set.
 */
export function checkStoredKey(envelope: SourceEnvelope): "ok" | "key_unavailable" | "key_mismatch" {
  const expected = configuredKeyCheck();
  if (!expected.ok) return "key_unavailable";
  const stored = Buffer.from(envelope.keyCheck, "base64");
  return timingSafeEqual(stored, expected.keyCheck) ? "ok" : "key_mismatch";
}

/**
 * Decrypts a stored envelope in the fixed order: key, `keyCheck`, authenticated decryption, JSON. A structurally invalid
 * envelope is `malformed`. Every other failure keeps its own class. The plaintext is returned only on full success.
 */
export function decodeSourceRecord(envelope: SourceEnvelope): SourceDecodeResult {
  const key = checkStoredKey(envelope);
  if (key === "key_unavailable") return { ok: false, error: "key_unavailable" };
  if (key === "key_mismatch") return { ok: false, error: "key_mismatch" };

  let bytes: Buffer;
  try {
    bytes = decryptToBytes(envelope);
  } catch (error) {
    if (error instanceof EncryptedPayloadAuthenticationError) return { ok: false, error: "payload_unauthenticated" };
    return { ok: false, error: "key_unavailable" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "malformed" };
  }
}

function isBase64(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && KEY_CHECK_BASE64.test(value);
}

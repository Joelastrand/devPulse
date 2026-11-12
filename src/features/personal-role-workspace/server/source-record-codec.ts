import "server-only";
import {
  checkRecordKeyCheck,
  decryptRecord,
  encryptRecord,
  RecordEnvelopeError,
  recordKeyCheck,
} from "../../../lib/encryption/record-envelope";
import { SOURCE_KEY_ID, SOURCE_KEY_VERSION } from "../domain/constants";

/**
 * The source-record codec (SECURITY.md PR-SI-5). It is the only code that encrypts or decrypts a responsibility or an
 * achievement. It uses the record envelope v2 (`src/lib/encryption/record-envelope.ts`), and every record is sealed with
 * AAD `personal-record:<ownerUid>:<collection>:<recordId>`, so a record cannot be moved to another owner, collection or id.
 *
 * PR-SI-5 keeps four failure classes apart, and this module keeps them apart too:
 * - `key_unavailable`: configuration missing or invalid (class B). Never a deletable item.
 * - `key_mismatch`: the stored `keyCheck` differs from the configured key (class C). Checked before any decryption, so a
 *   wrong key is never reported as tampering.
 * - `payload_unauthenticated`: the GCM tag failed although the key matched (class D: corruption or tampering). Never a
 *   deletable item either.
 * - `malformed`: the envelope or the plaintext is structurally invalid (class E). Only this class may become a deletable
 *   item, and the caller decides that.
 */

export interface SourceEnvelope {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: typeof SOURCE_KEY_VERSION;
  keyId: typeof SOURCE_KEY_ID;
  keyCheck: string;
}

export type SourceCodecFailure = "key_unavailable" | "key_mismatch" | "payload_unauthenticated" | "malformed";

export type SourceEncodeResult = { ok: true; envelope: SourceEnvelope } | { ok: false; error: "key_unavailable" };
export type SourceDecodeResult = { ok: true; json: unknown } | { ok: false; error: SourceCodecFailure };

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** The AAD of one personal record: its owner, collection and document id. The id is the document's own Firestore id. */
export function sourceRecordContext(ownerUid: string, collection: string, recordId: string): string {
  return `personal-record:${ownerUid}:${collection}:${recordId}`;
}

/** Seals the JSON form of a validated payload for one record. The plaintext never leaves this function unencrypted. */
export function encodeSourceRecord(payload: Record<string, unknown>, context: string): SourceEncodeResult {
  let keyCheck: string;
  let sealed: ReturnType<typeof encryptRecord>;
  try {
    keyCheck = recordKeyCheck();
    sealed = encryptRecord(JSON.stringify(payload), context);
  } catch {
    return { ok: false, error: "key_unavailable" };
  }
  return {
    ok: true,
    envelope: {
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      keyVersion: SOURCE_KEY_VERSION,
      keyId: SOURCE_KEY_ID,
      keyCheck,
    },
  };
}

/** The envelope fields of a stored document, or `null` when the structure is not a valid envelope. Strings only. */
export function readEnvelope(data: Record<string, unknown>): SourceEnvelope | null {
  const { ciphertext, iv, authTag, keyVersion, keyId, keyCheck } = data;
  if (keyVersion !== SOURCE_KEY_VERSION || keyId !== SOURCE_KEY_ID) return null;
  if (!isBase64(ciphertext) || !isBase64(iv) || !isBase64(authTag) || !isBase64(keyCheck)) return null;
  if (Buffer.from(iv, "base64").length !== 12 || Buffer.from(authTag, "base64").length !== 16) return null;
  if (Buffer.from(keyCheck, "base64").length !== 32) return null;
  return { ciphertext, iv, authTag, keyVersion: SOURCE_KEY_VERSION, keyId: SOURCE_KEY_ID, keyCheck };
}

/**
 * Checks the stored `keyCheck` against the configured key without decrypting anything. Used before any write on an owner's
 * existing records, so a key change can never produce a mixed set.
 */
export function checkStoredKey(envelope: SourceEnvelope): "ok" | "key_unavailable" | "key_mismatch" {
  const status = checkRecordKeyCheck(envelope.keyCheck);
  if (status === "ok") return "ok";
  return status === "key_unavailable" ? "key_unavailable" : "key_mismatch";
}

/**
 * Decrypts a stored envelope in the fixed order: key, `keyCheck`, authenticated decryption, UTF-8, JSON. A structurally
 * invalid envelope is `malformed`. Every other failure keeps its own class. The plaintext is returned only on full success.
 */
export function decodeSourceRecord(envelope: SourceEnvelope, context: string): SourceDecodeResult {
  const key = checkStoredKey(envelope);
  if (key === "key_unavailable") return { ok: false, error: "key_unavailable" };
  if (key === "key_mismatch") return { ok: false, error: "key_mismatch" };

  let text: string;
  try {
    text = decryptRecord(
      { ciphertext: envelope.ciphertext, iv: envelope.iv, authTag: envelope.authTag, keyVersion: "v2", keyId: "k1" },
      context,
    );
  } catch (error) {
    if (!(error instanceof RecordEnvelopeError)) return { ok: false, error: "key_unavailable" };
    switch (error.code) {
      case "authentication_failed":
        return { ok: false, error: "payload_unauthenticated" };
      case "malformed":
        return { ok: false, error: "malformed" };
      case "unknown_key_id":
        return { ok: false, error: "key_mismatch" };
      case "key_unavailable":
        return { ok: false, error: "key_unavailable" };
    }
  }
  try {
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "malformed" };
  }
}

function isBase64(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && BASE64_PATTERN.test(value);
}

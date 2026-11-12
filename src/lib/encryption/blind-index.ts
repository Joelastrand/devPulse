import "server-only";
import { createHmac, hkdfSync } from "node:crypto";
import { readEncryptionKeyBytes } from "./encryption";

/**
 * Keyed blind indexes for values that must be matched without being stored in the clear (for example an invitation email).
 *
 * - Each purpose has its own key: HKDF-SHA-256 over the master `ENCRYPTION_KEY`, labelled `devpulse/blind-index/v1/<purpose>`.
 *   The master key is never used directly, and the index key is separate from the record-envelope subkeys.
 * - The index is HMAC-SHA-256 of the value under that key, hex encoded. It is deterministic for a purpose (that is the point
 *   of an index), but it cannot be computed without the key, so an unkeyed hash of a guessable value is not stored.
 * - The caller must normalize the value first. A different normalization is a different index.
 *
 * Fails closed: a missing or unusable master key throws, so no index is ever computed from a fallback key.
 */

const INDEX_INFO_PREFIX = "devpulse/blind-index/v1/";
const KEY_LENGTH_BYTES = 32;

export type BlindIndexPurpose = "team-invitation-email" | "roadmap-owner-ref";

function deriveIndexKey(purpose: BlindIndexPurpose): Buffer {
  const master = readEncryptionKeyBytes();
  if (master.length !== KEY_LENGTH_BYTES) throw new Error("blind_index_key_unavailable");
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from(INDEX_INFO_PREFIX + purpose, "utf8"), KEY_LENGTH_BYTES));
}

/** Hex HMAC-SHA-256 of `value` under the purpose's derived key. Synchronous; throws when the key is unavailable. */
export function blindIndex(purpose: BlindIndexPurpose, value: string): string {
  return createHmac("sha256", deriveIndexKey(purpose)).update(value, "utf8").digest("hex");
}

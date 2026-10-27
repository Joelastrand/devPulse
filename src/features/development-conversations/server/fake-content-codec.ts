import "server-only";
import { parseConversationContent, type ConversationContent } from "../domain/content-payload";
import type { DecryptOutcome, StoredEnvelope } from "../domain/stored-owner-conversation";
import { STORED_KEY_VERSION } from "../domain/stored-owner-conversation";
import type { DecodeContentResult, EncodeContentResult, KeyFailure, ProbeKeyResult } from "./content-codec";

/**
 * Test double for the content codec. It is deterministic and uses no crypto and no key. The envelope is structurally
 * valid for TASK-002 (canonical base64 of the right lengths), and the ciphertext is an opaque handle. The content is
 * held only as JSON text in a private in-memory map, so no stored object contains readable content. Tampering with the
 * handle is an authentication failure, as with the real codec. `setKeyFailure` simulates an operational key outage
 * (`key_unavailable`) or a key mismatch (`key_mismatch`) for operation tests.
 */

/** 12 zero bytes, the helper's IV length. Synthetic, not random. */
const FAKE_IV = "AAAAAAAAAAAAAAAA";
/** 16 zero bytes, the helper's auth-tag length. Synthetic. */
const FAKE_AUTH_TAG = "AAAAAAAAAAAAAAAAAAAAAA==";
/** 32 zero bytes, the canonical form of an HMAC-SHA-256 output. Synthetic. */
const FAKE_KEY_CHECK = "A".repeat(43) + "=";

export interface FakeContentCodec {
  probeKey(): ProbeKeyResult;
  encodeContent(content: ConversationContent): EncodeContentResult;
  decodeContent(envelope: StoredEnvelope): DecodeContentResult;
  decryptForClassification(envelope: StoredEnvelope): DecryptOutcome;
  /** Simulates a key outage or a key mismatch; `null` restores normal operation. */
  setKeyFailure(failure: KeyFailure | null): void;
}

export function createFakeContentCodec(): FakeContentCodec {
  const store = new Map<string, string>();
  let nextHandle = 1;
  let keyFailure: KeyFailure | null = null;

  function envelopeFor(handle: string): StoredEnvelope {
    return {
      ciphertext: Buffer.from(handle, "utf8").toString("base64"),
      iv: FAKE_IV,
      authTag: FAKE_AUTH_TAG,
      keyVersion: STORED_KEY_VERSION,
      keyCheck: FAKE_KEY_CHECK,
    };
  }

  /** The stored JSON text for an envelope, or `null` when the handle is unknown (treated as an authentication failure). */
  function lookup(envelope: StoredEnvelope): string | null {
    const handle = Buffer.from(envelope.ciphertext, "base64").toString("utf8");
    return store.get(handle) ?? null;
  }

  return {
    probeKey() {
      return keyFailure === "key_unavailable" ? { ok: false, error: "key_unavailable" } : { ok: true };
    },
    encodeContent(content) {
      if (keyFailure === "key_unavailable") {
        return { ok: false, error: "key_unavailable" };
      }
      const handle = `fake-handle-${nextHandle}`;
      nextHandle += 1;
      // JSON form, as the real codec writes it: `capturedAt` becomes an ISO string.
      store.set(handle, JSON.stringify(content));
      return { ok: true, content: envelopeFor(handle) };
    },
    decodeContent(envelope) {
      if (keyFailure !== null) {
        return { ok: false, error: keyFailure };
      }
      const text = lookup(envelope);
      if (text === null) {
        return { ok: false, error: "payload_unauthenticated" };
      }
      const parsed = parseConversationContent(JSON.parse(text));
      return parsed.ok ? { ok: true, content: parsed.content } : { ok: false, error: "malformed_payload" };
    },
    decryptForClassification(envelope) {
      if (keyFailure !== null) {
        throw new Error(keyFailure);
      }
      const text = lookup(envelope);
      if (text === null) {
        return { status: "authentication_failed" };
      }
      return { status: "decrypted", payload: JSON.parse(text) };
    },
    setKeyFailure(failure) {
      keyFailure = failure;
    },
  };
}

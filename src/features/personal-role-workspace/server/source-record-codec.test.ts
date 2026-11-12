import { createCipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCE_KEY_ID, SOURCE_KEY_VERSION } from "../domain/constants";
import {
  checkStoredKey,
  decodeSourceRecord,
  encodeSourceRecord,
  readEnvelope,
  sourceRecordContext,
  type SourceEnvelope,
} from "./source-record-codec";

/*
 * Synthetic test data only. The reference computations below use `node:crypto` directly (HKDF for the record subkey, HMAC
 * for the key check, AES-256-GCM with the record context as AAD), so the codec is checked against an outside reference.
 */

const OWNER = "synthetic-owner";
const COLLECTION = "responsibilities";
const RECORD_ID = "synthetic-record-1";
const CTX = sourceRecordContext(OWNER, COLLECTION, RECORD_ID);
const PAYLOAD = { title: "Syntetisk ansvar æøå 🙂", description: "Synthetic description" };

function referenceSubkey(keyBytes: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", keyBytes, Buffer.alloc(0), Buffer.from(`devpulse/record/v2/${SOURCE_KEY_ID}`, "utf8"), 32));
}

function referenceKeyCheck(keyBytes: Buffer): string {
  return createHmac("sha256", referenceSubkey(keyBytes))
    .update(`devpulse/record/v2/key-check/${SOURCE_KEY_ID}`, "utf8")
    .digest("base64");
}

function sealRaw(plaintext: Buffer, keyBytes: Buffer, context: string = CTX): SourceEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", referenceSubkey(keyBytes), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: SOURCE_KEY_VERSION,
    keyId: SOURCE_KEY_ID,
    keyCheck: referenceKeyCheck(keyBytes),
  };
}

function tamper(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  bytes[0] = bytes[0] ^ 0xff;
  return bytes.toString("base64");
}

function encodeOrThrow(payload: Record<string, unknown> = PAYLOAD, context: string = CTX): SourceEnvelope {
  const encoded = encodeSourceRecord(payload, context);
  if (!encoded.ok) throw new Error("expected encodeSourceRecord to succeed");
  return encoded.envelope;
}

describe("source-record codec (record envelope v2, PR-SI-5)", () => {
  let keyBytes: Buffer;

  beforeEach(() => {
    keyBytes = randomBytes(32);
    vi.stubEnv("ENCRYPTION_KEY", keyBytes.toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("round trip and stored shape", () => {
    it("decodes an encoded payload back under the same record context", () => {
      expect(decodeSourceRecord(encodeOrThrow(), CTX)).toEqual({ ok: true, json: PAYLOAD });
    });

    it("stores exactly the envelope keys and no plaintext title or description", () => {
      const envelope = encodeOrThrow();
      expect(Object.keys(envelope).sort()).toEqual(["authTag", "ciphertext", "iv", "keyCheck", "keyId", "keyVersion"]);
      const serialized = JSON.stringify(envelope);
      expect(serialized).not.toContain("Syntetisk ansvar");
      expect(serialized).not.toContain("Synthetic description");
    });

    it("writes the v2 literals and the keyCheck of the independent reference", () => {
      const envelope = encodeOrThrow();
      expect(envelope.keyVersion).toBe("v2");
      expect(envelope.keyId).toBe("k1");
      expect(envelope.keyCheck).toBe(referenceKeyCheck(keyBytes));
    });

    it("opens a record sealed by the independent AES-GCM reference", () => {
      const sealed = sealRaw(Buffer.from(JSON.stringify(PAYLOAD), "utf8"), keyBytes);
      expect(decodeSourceRecord(sealed, CTX)).toEqual({ ok: true, json: PAYLOAD });
    });

    it("does not put key bytes or the key itself into the envelope", () => {
      const serialized = JSON.stringify(encodeOrThrow());
      expect(serialized).not.toContain(keyBytes.toString("base64"));
    });
  });

  describe("PR-SI-5 failure classes stay apart", () => {
    it("classifies a wrong key as key_mismatch before any decryption, never as payload_unauthenticated", () => {
      const envelope = encodeOrThrow();
      vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      expect(decodeSourceRecord(envelope, CTX)).toEqual({ ok: false, error: "key_mismatch" });
      expect(checkStoredKey(envelope)).toBe("key_mismatch");
    });

    it("classifies a missing key as key_unavailable, never as malformed", () => {
      const envelope = encodeOrThrow();
      vi.stubEnv("ENCRYPTION_KEY", "");
      expect(decodeSourceRecord(envelope, CTX)).toEqual({ ok: false, error: "key_unavailable" });
      expect(encodeSourceRecord(PAYLOAD, CTX)).toEqual({ ok: false, error: "key_unavailable" });
    });

    it("classifies tampered ciphertext with a matching keyCheck as payload_unauthenticated, never as malformed", () => {
      const envelope = encodeOrThrow();
      expect(decodeSourceRecord({ ...envelope, ciphertext: tamper(envelope.ciphertext) }, CTX)).toEqual({
        ok: false,
        error: "payload_unauthenticated",
      });
    });

    it("classifies authenticated bytes that are not JSON as malformed, the only deletable class", () => {
      const envelope = sealRaw(Buffer.from("not json", "utf8"), keyBytes);
      expect(decodeSourceRecord(envelope, CTX)).toEqual({ ok: false, error: "malformed" });
    });

    it("classifies authenticated invalid UTF-8 as malformed, never as payload_unauthenticated", () => {
      const envelope = sealRaw(Buffer.from([0x7b, 0xff, 0x7d]), keyBytes);
      expect(decodeSourceRecord(envelope, CTX)).toEqual({ ok: false, error: "malformed" });
    });
  });

  describe("record substitution (AAD binds owner, collection and id)", () => {
    it("refuses a record opened under another record id", () => {
      const envelope = encodeOrThrow();
      expect(decodeSourceRecord(envelope, sourceRecordContext(OWNER, COLLECTION, "another-record"))).toEqual({
        ok: false,
        error: "payload_unauthenticated",
      });
    });

    it("refuses a record opened under another owner or another collection", () => {
      const envelope = encodeOrThrow();
      expect(decodeSourceRecord(envelope, sourceRecordContext("another-owner", COLLECTION, RECORD_ID))).toEqual({
        ok: false,
        error: "payload_unauthenticated",
      });
      expect(decodeSourceRecord(envelope, sourceRecordContext(OWNER, "achievements", RECORD_ID))).toEqual({
        ok: false,
        error: "payload_unauthenticated",
      });
    });
  });

  describe("readEnvelope structure", () => {
    it("accepts a complete v2 envelope and rejects a v1 envelope, a foreign key id and a wrong keyCheck length", () => {
      const envelope = encodeOrThrow();
      expect(readEnvelope({ ...envelope })).toEqual(envelope);
      expect(readEnvelope({ ...envelope, keyVersion: "v1" })).toBeNull();
      expect(readEnvelope({ ...envelope, keyId: "k2" })).toBeNull();
      expect(readEnvelope({ ...envelope, keyCheck: Buffer.alloc(16).toString("base64") })).toBeNull();
    });
  });
});

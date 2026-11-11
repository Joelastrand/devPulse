import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { decodeSourceRecord, encodeSourceRecord, checkStoredKey, readEnvelope, configuredKeyCheck } from "./source-record-codec";
import { SOURCE_KEY_CHECK_CONTEXT } from "../domain/constants";

const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 9).toString("base64");
const original = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY_A;
});
afterEach(() => {
  if (original === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = original;
});

function sealed(payload: Record<string, unknown> = { title: "Kodegjennomgang", description: "Hemmelig tekst" }) {
  const result = encodeSourceRecord(payload);
  if (!result.ok) throw new Error("setup failed");
  return result.envelope;
}

describe("source-record codec (PR-SI-5, C-5)", () => {
  it("round-trips a payload and never stores the plaintext", () => {
    const envelope = sealed();
    expect(JSON.stringify(envelope)).not.toContain("Hemmelig");
    expect(JSON.stringify(envelope)).not.toContain("Kodegjennomgang");
    expect(decodeSourceRecord(envelope)).toEqual({ ok: true, json: { title: "Kodegjennomgang", description: "Hemmelig tekst" } });
  });

  it("uses a keyCheck derived with the source-record context, not the conversation context", () => {
    const envelope = sealed();
    const expected = createHmac("sha256", Buffer.from(KEY_A, "base64")).update(SOURCE_KEY_CHECK_CONTEXT, "utf8").digest("base64");
    expect(envelope.keyCheck).toBe(expected);
    const conversationContext = createHmac("sha256", Buffer.from(KEY_A, "base64")).update("devpulse.d2.conversation-key-check.v1", "utf8").digest("base64");
    expect(envelope.keyCheck).not.toBe(conversationContext);
  });

  it("classifies a wrong key as key_mismatch before any decryption", () => {
    const envelope = sealed();
    process.env.ENCRYPTION_KEY = KEY_B;
    expect(checkStoredKey(envelope)).toBe("key_mismatch");
    expect(decodeSourceRecord(envelope)).toEqual({ ok: false, error: "key_mismatch" });
  });

  it("classifies a missing key as key_unavailable, never as malformed", () => {
    const envelope = sealed();
    delete process.env.ENCRYPTION_KEY;
    expect(configuredKeyCheck()).toEqual({ ok: false, error: "key_unavailable" });
    expect(decodeSourceRecord(envelope)).toEqual({ ok: false, error: "key_unavailable" });
    expect(encodeSourceRecord({ title: "x" })).toEqual({ ok: false, error: "key_unavailable" });
  });

  it("classifies an invalid key length as key_unavailable", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(encodeSourceRecord({ title: "x" })).toEqual({ ok: false, error: "key_unavailable" });
  });

  it("classifies tampered ciphertext with a matching keyCheck as payload_unauthenticated", () => {
    const envelope = sealed();
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] = bytes[0] ^ 0xff;
    expect(decodeSourceRecord({ ...envelope, ciphertext: bytes.toString("base64") })).toEqual({ ok: false, error: "payload_unauthenticated" });
  });

  it("rejects a structurally invalid envelope as malformed", () => {
    expect(readEnvelope({ ciphertext: "abc", iv: "abc", authTag: "abc", keyVersion: "v9", keyCheck: "abc" })).toBeNull();
    expect(readEnvelope({ ciphertext: "not base64!", iv: "a", authTag: "a", keyVersion: "v1", keyCheck: "a" })).toBeNull();
  });

  it("does not put key bytes or key identifiers into the envelope", () => {
    const serialized = JSON.stringify(sealed());
    expect(serialized).not.toContain(KEY_A);
    expect(serialized).not.toContain(Buffer.alloc(32, 7).toString("hex"));
  });
});

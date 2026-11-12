import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptRecord,
  encryptRecord,
  checkRecordKeyCheck,
  readRecordEnvelope,
  RecordEnvelopeError,
  recordKeyCheck,
  type RecordEnvelope,
} from "./record-envelope";

describe("record envelope v2", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips plaintext under the same record context", () => {
    const envelope = encryptRecord("Lær Kubernetes", "goal:uid-1:goal-1");
    expect(decryptRecord(envelope, "goal:uid-1:goal-1")).toBe("Lær Kubernetes");
  });

  it("stores ciphertext, not the plaintext, and tags the envelope version and key id", () => {
    const envelope = encryptRecord("secret goal title", "goal:uid-1:goal-1");
    expect(JSON.stringify(envelope)).not.toContain("secret goal title");
    expect(envelope.keyVersion).toBe("v2");
    expect(envelope.keyId).toBe("k1");
  });

  it("uses a fresh IV and ciphertext for every encryption of the same plaintext", () => {
    const first = encryptRecord("same", "goal:uid-1:goal-1");
    const second = encryptRecord("same", "goal:uid-1:goal-1");
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects decryption under a different record context (substitution across records)", () => {
    const envelope = encryptRecord("title", "goal:uid-1:goal-1");
    expect(() => decryptRecord(envelope, "goal:uid-1:goal-2")).toThrow(RecordEnvelopeError);
    expect(() => decryptRecord(envelope, "goal:uid-2:goal-1")).toThrow(RecordEnvelopeError);
    try {
      decryptRecord(envelope, "goal:uid-2:goal-1");
    } catch (error) {
      expect((error as RecordEnvelopeError).code).toBe("authentication_failed");
    }
  });

  it("rejects tampered ciphertext, IV and auth tag", () => {
    const envelope = encryptRecord("title", "goal:uid-1:goal-1");
    const flip = (base64: string): string => {
      const bytes = Buffer.from(base64, "base64");
      bytes[0] ^= 0x01;
      return bytes.toString("base64");
    };
    const tampered: RecordEnvelope[] = [
      { ...envelope, ciphertext: flip(envelope.ciphertext) },
      { ...envelope, iv: flip(envelope.iv) },
      { ...envelope, authTag: flip(envelope.authTag) },
    ];
    for (const candidate of tampered) {
      expect(() => decryptRecord(candidate, "goal:uid-1:goal-1")).toThrow(RecordEnvelopeError);
    }
  });

  it("rejects decryption with a different master key", () => {
    const envelope = encryptRecord("title", "goal:uid-1:goal-1");
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(() => decryptRecord(envelope, "goal:uid-1:goal-1")).toThrow(RecordEnvelopeError);
  });

  it("fails closed with key_unavailable when ENCRYPTION_KEY is missing", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => encryptRecord("title", "goal:uid-1:goal-1")).toThrow(
      expect.objectContaining({ code: "key_unavailable" }),
    );
  });

  it("fails closed with key_unavailable when ENCRYPTION_KEY has the wrong length", () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    try {
      encryptRecord("title", "goal:uid-1:goal-1");
      expect.unreachable();
    } catch (error) {
      expect((error as RecordEnvelopeError).code).toBe("key_unavailable");
    }
  });

  it("does not echo plaintext or key material in the error message", () => {
    const envelope = encryptRecord("visible-title", "goal:uid-1:goal-1");
    try {
      decryptRecord({ ...envelope, authTag: Buffer.alloc(16).toString("base64") }, "goal:uid-1:goal-1");
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("visible-title");
      expect((error as Error).message).not.toContain(envelope.ciphertext);
    }
  });

  it("refuses an unknown key id", () => {
    const envelope = encryptRecord("title", "goal:uid-1:goal-1");
    expect(() => decryptRecord({ ...envelope, keyId: "k9" } as unknown as RecordEnvelope, "goal:uid-1:goal-1")).toThrow(
      RecordEnvelopeError,
    );
  });

  it("refuses an empty record context on both sides", () => {
    expect(() => encryptRecord("title", "")).toThrow(RecordEnvelopeError);
    const envelope = encryptRecord("title", "goal:uid-1:goal-1");
    expect(() => decryptRecord(envelope, "")).toThrow(RecordEnvelopeError);
  });

  it("validates the stored envelope structure before use", () => {
    const envelope = encryptRecord("title", "goal:uid-1:goal-1");
    expect(readRecordEnvelope(envelope)).toEqual(envelope);
    expect(readRecordEnvelope({ ...envelope, keyVersion: "v1" })).toBeNull();
    expect(readRecordEnvelope({ ...envelope, iv: "not base64!" })).toBeNull();
    expect(readRecordEnvelope({ ...envelope, iv: Buffer.alloc(8).toString("base64") })).toBeNull();
    expect(readRecordEnvelope({ ...envelope, authTag: Buffer.alloc(8).toString("base64") })).toBeNull();
    expect(readRecordEnvelope(undefined)).toBeNull();
    expect(readRecordEnvelope("plaintext")).toBeNull();
  });

  it("reports a malformed envelope as malformed, not as authentication failure", () => {
    try {
      decryptRecord({ ciphertext: "x", iv: "x", authTag: "x", keyVersion: "v2", keyId: "k1" } as unknown as RecordEnvelope, "c");
      expect.unreachable();
    } catch (error) {
      expect((error as RecordEnvelopeError).code).toBe("malformed");
    }
  });
});

describe("record key check (wrong key is not tampering)", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports ok for the configured key and is deterministic for it", () => {
    const check = recordKeyCheck();
    expect(checkRecordKeyCheck(check)).toBe("ok");
    expect(recordKeyCheck()).toBe(check);
  });

  it("reports key_mismatch when the configured key changed, without decrypting anything", () => {
    const check = recordKeyCheck();
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(checkRecordKeyCheck(check)).toBe("key_mismatch");
  });

  it("reports malformed for a value that is not a key check, and key_unavailable when no key is configured", () => {
    expect(checkRecordKeyCheck("not-a-key-check")).toBe("malformed");
    expect(checkRecordKeyCheck(undefined)).toBe("malformed");
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(checkRecordKeyCheck(Buffer.alloc(32).toString("base64"))).toBe("key_unavailable");
  });

  it("never stores or returns the master key: the check is not the key bytes", () => {
    const check = recordKeyCheck();
    expect(Buffer.from(check, "base64").length).toBe(32);
    expect(check).not.toBe(process.env.ENCRYPTION_KEY);
  });
});

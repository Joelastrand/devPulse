import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decrypt,
  decryptToBytes,
  EncryptedPayloadAuthenticationError,
  encrypt,
  readEncryptionKeyBytes,
} from "./encryption";

function generateValidKey(): string {
  return randomBytes(32).toString("base64");
}

describe("encryption", () => {
  let validKey: string;

  beforeEach(() => {
    validKey = generateValidKey();
    vi.stubEnv("ENCRYPTION_KEY", validKey);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("produces different ciphertext for two encryptions of the same plaintext", () => {
    const first = encrypt("same plaintext");
    const second = encrypt("same plaintext");

    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("generates a distinct IV for every encryption operation", () => {
    const first = encrypt("payload one");
    const second = encrypt("payload two");

    expect(first.iv).not.toBe(second.iv);
  });

  it("round-trips both encrypted outputs back to their original plaintext", () => {
    const plaintextA = "flow=4;stress=2;fun=5";
    const plaintextB = "flow=1;stress=5;fun=1";

    expect(decrypt(encrypt(plaintextA))).toBe(plaintextA);
    expect(decrypt(encrypt(plaintextB))).toBe(plaintextB);
  });

  it("fails authentication when the ciphertext has been tampered with", () => {
    const payload = encrypt("sensitive answer");
    const tamperedBytes = Buffer.from(payload.ciphertext, "base64");
    tamperedBytes[0] = tamperedBytes[0] ^ 0xff;

    const tampered = { ...payload, ciphertext: tamperedBytes.toString("base64") };

    expect(() => decrypt(tampered)).toThrow();
  });

  it("fails authentication when the auth tag has been tampered with", () => {
    const payload = encrypt("sensitive answer");
    const tamperedBytes = Buffer.from(payload.authTag, "base64");
    tamperedBytes[0] = tamperedBytes[0] ^ 0xff;

    const tampered = { ...payload, authTag: tamperedBytes.toString("base64") };

    expect(() => decrypt(tampered)).toThrow();
  });

  it("includes the required IV and key/algorithm version metadata", () => {
    const payload = encrypt("payload");

    expect(payload.iv.length).toBeGreaterThan(0);
    expect(payload.keyVersion).toBe("v1");
    expect(payload.authTag.length).toBeGreaterThan(0);
  });

  it("never includes the raw key material or the source environment value", () => {
    const payload = encrypt("payload");
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain(validKey);
  });

  it("fails closed when the encryption key is missing", () => {
    delete process.env.ENCRYPTION_KEY;

    expect(() => encrypt("payload")).toThrow();
  });

  it("fails closed when the encryption key is an empty string", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");

    expect(() => encrypt("payload")).toThrow();
  });

  it("fails closed when the encryption key is not valid base64", () => {
    vi.stubEnv("ENCRYPTION_KEY", "not-valid-base64!!!");

    expect(() => encrypt("payload")).toThrow();
  });

  it("fails closed when the encryption key decodes to the wrong length", () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(16).toString("base64"));

    expect(() => encrypt("payload")).toThrow();
  });

  it("does not leak the misconfigured key value in the thrown error", () => {
    const badKey = "not-valid-base64!!!";
    vi.stubEnv("ENCRYPTION_KEY", badKey);

    try {
      encrypt("payload");
      throw new Error("expected encrypt to throw");
    } catch (error) {
      expect(String(error)).not.toContain(badKey);
    }
  });

  it("never logs plaintext, ciphertext, key material, or errors for success or failure paths", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    encrypt("a sensitive answer");

    vi.stubEnv("ENCRYPTION_KEY", "");
    try {
      encrypt("another sensitive answer");
    } catch {
      // expected: fail closed
    }

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("encryption key bytes and byte-level decrypt", () => {
  let validKey: string;

  beforeEach(() => {
    validKey = randomBytes(32).toString("base64");
    vi.stubEnv("ENCRYPTION_KEY", validKey);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns exactly the 32 validated key bytes that the key string decodes to", () => {
    const key = readEncryptionKeyBytes();

    expect(key.length).toBe(32);
    expect(key.equals(Buffer.from(validKey, "base64"))).toBe(true);
  });

  it("returns a fresh buffer per call, not a shared cached instance", () => {
    const first = readEncryptionKeyBytes();
    first.fill(0);

    expect(readEncryptionKeyBytes().equals(Buffer.from(validKey, "base64"))).toBe(true);
  });

  it("keeps the missing-key failure for the accessor", () => {
    delete process.env.ENCRYPTION_KEY;

    expect(() => readEncryptionKeyBytes()).toThrow("ENCRYPTION_KEY is not configured");
  });

  it("keeps the invalid-base64 failure for the accessor", () => {
    vi.stubEnv("ENCRYPTION_KEY", "not-valid-base64!!!");

    expect(() => readEncryptionKeyBytes()).toThrow("not valid base64");
  });

  it("keeps the wrong-decoded-length failure for the accessor", () => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(16).toString("base64"));

    expect(() => readEncryptionKeyBytes()).toThrow("must decode to 32 bytes");
  });

  it("never includes the raw key or its decoded bytes in accessor errors", () => {
    const badKey = "not-valid-base64!!!";
    vi.stubEnv("ENCRYPTION_KEY", badKey);

    try {
      readEncryptionKeyBytes();
      throw new Error("expected the accessor to throw");
    } catch (error) {
      const text = String(error);
      expect(text).not.toContain(badKey);
      expect(text).not.toContain(validKey);
    }
  });

  it("returns the exact authenticated plaintext bytes from decryptToBytes", () => {
    const plaintext = "Ærlig samtale ✓ 🙂";
    const payload = encrypt(plaintext);

    expect(decryptToBytes(payload).equals(Buffer.from(plaintext, "utf8"))).toBe(true);
  });

  it("keeps string decrypt returning the same text as the byte primitive", () => {
    const plaintext = "flow=4;stress=2;fun=5";
    const payload = encrypt(plaintext);

    expect(decrypt(payload)).toBe(decryptToBytes(payload).toString("utf8"));
    expect(decrypt(payload)).toBe(plaintext);
  });

  it("still fails authentication for tampered ciphertext through decryptToBytes", () => {
    const payload = encrypt("sensitive answer");
    const tamperedBytes = Buffer.from(payload.ciphertext, "base64");
    tamperedBytes[0] = tamperedBytes[0] ^ 0xff;

    expect(() => decryptToBytes({ ...payload, ciphertext: tamperedBytes.toString("base64") })).toThrow(
      EncryptedPayloadAuthenticationError,
    );
  });

  it("reports only EncryptedPayloadAuthenticationError for a failed GCM tag", () => {
    const payload = encrypt("sensitive answer");
    const tamperedBytes = Buffer.from(payload.authTag, "base64");
    tamperedBytes[0] = tamperedBytes[0] ^ 0xff;

    expect(() => decryptToBytes({ ...payload, authTag: tamperedBytes.toString("base64") })).toThrow(
      EncryptedPayloadAuthenticationError,
    );
  });

  it("produces an authentication error that carries no key or payload bytes", () => {
    const payload = encrypt("sensitive answer");
    const tamperedBytes = Buffer.from(payload.ciphertext, "base64");
    tamperedBytes[0] = tamperedBytes[0] ^ 0xff;
    const tampered = { ...payload, ciphertext: tamperedBytes.toString("base64") };

    try {
      decryptToBytes(tampered);
      throw new Error("expected decryptToBytes to throw");
    } catch (error) {
      const text = String(error);
      expect(text).not.toContain(validKey);
      expect(text).not.toContain(tampered.ciphertext);
      expect(text).not.toContain(tampered.iv);
    }
  });

  it("does not replace the key-accessor error with an authentication error when the key is missing", () => {
    const payload = encrypt("payload");
    delete process.env.ENCRYPTION_KEY;

    expect(() => decryptToBytes(payload)).toThrow("ENCRYPTION_KEY is not configured");
    expect(() => decryptToBytes(payload)).not.toThrow(EncryptedPayloadAuthenticationError);
  });
});

import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_VERSION = "v1";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: typeof KEY_VERSION;
}

/**
 * Encrypts `plaintext` with AES-256-GCM using a fresh random IV, reading the
 * key from `ENCRYPTION_KEY` at call time. Fails closed (throws) rather than
 * falling back to plaintext when the key is missing or unusable.
 */
export function encrypt(plaintext: string): EncryptedPayload {
  const key = readEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: KEY_VERSION,
  };
}

/**
 * Reverses `encrypt`. This is the first authorized decryption path in the
 * codebase (`docs/features/results-dashboard/SPEC.md`) — callers must be
 * server-side, authorized aggregation code (`src/features/results/`), never
 * a route handler returning decrypted content directly to a client
 * (`docs/SECURITY.md` invariant 10). Throws on a missing/invalid key or a
 * tampered/corrupt payload; callers must not log the thrown error, since it
 * may echo ciphertext/IV bytes.
 */
export function decrypt(payload: EncryptedPayload): string {
  const key = readEncryptionKey();
  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

function readEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;

  if (!raw) {
    throw new Error(
      "Encryption is unavailable: ENCRYPTION_KEY is not configured.",
    );
  }

  if (!BASE64_PATTERN.test(raw)) {
    throw new Error(
      "Encryption is unavailable: ENCRYPTION_KEY is not valid base64.",
    );
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `Encryption is unavailable: ENCRYPTION_KEY must decode to ${KEY_LENGTH_BYTES} bytes.`,
    );
  }

  return key;
}

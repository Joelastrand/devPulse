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
 * Reverses `encrypt`. Callers must always be server-side, authorized code —
 * never called from client-reachable code, and never from an unauthorized
 * request path. Whether the resulting plaintext may then be returned
 * directly to an authorized client, or must instead be aggregated/suppressed
 * before any value derived from it leaves the server, is a per-feature
 * product decision, not a rule this function enforces: Survey Responses
 * (`docs/features/results-dashboard/SPEC.md`) only ever expose a
 * threshold-gated aggregate, never a decrypted response itself, while
 * Anonymous Challenges (`docs/features/anonymous-challenges/SPEC.md`) and
 * Team Forum (`docs/features/team-forum/SPEC.md`) decrypt content and return
 * it directly to an authorized team member/admin, since individually-visible
 * content is each feature's own deliberate design — identity, not content,
 * is what those two features keep hidden. Throws on a missing/invalid key or
 * a tampered/corrupt payload; callers must not log the thrown error, since it
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

import { expect } from "vitest";
import type { RecordEnvelope } from "./record-envelope";

/**
 * Shared storage-boundary assertions for the converted collections. Test-only: each codec test states the business values it
 * seals (the secrets) and the codec's open function, then asserts the same properties everywhere:
 *
 * - no business value appears in the persisted payload (serialized as Firestore would store it);
 * - the envelope is a v2 record envelope;
 * - a tampered envelope is refused, not repaired;
 * - an envelope moved to another record (another context) is refused;
 * - a missing key fails closed (throws), with no plaintext fallback.
 */

export interface StorageBoundaryCase {
  /** The persisted document (metadata plaintext plus sealed envelope). */
  persisted: Record<string, unknown>;
  /** Business strings that must not appear anywhere in the persisted payload. */
  secrets: readonly string[];
  /** The envelope field name inside `persisted`. */
  envelopeField: string;
  /** Opens the persisted document for the record it was written for. Returns the opened shape or `null`. */
  open: (persisted: Record<string, unknown>) => unknown;
  /** Opens the same persisted content as if it belonged to another record (another id). */
  openAsOtherRecord: (persisted: Record<string, unknown>) => unknown;
  /** Runs `open` with the record key unavailable. */
  openWithoutKey: (persisted: Record<string, unknown>) => unknown;
}

export function expectNoPlaintextPersisted(persisted: Record<string, unknown>, secrets: readonly string[]): void {
  const serialized = JSON.stringify(persisted);
  for (const secret of secrets) {
    expect(serialized, `persisted payload must not contain "${secret}"`).not.toContain(secret);
  }
}

export function expectV2Envelope(persisted: Record<string, unknown>, envelopeField: string): void {
  expect(persisted[envelopeField]).toMatchObject({ keyVersion: "v2", keyId: "k1" });
}

/** Flips one bit of the ciphertext: GCM authentication must refuse the value (`null`), never return altered content. */
export function tamperEnvelope(persisted: Record<string, unknown>, envelopeField: string): Record<string, unknown> {
  const envelope = persisted[envelopeField] as RecordEnvelope;
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  return { ...persisted, [envelopeField]: { ...envelope, ciphertext: bytes.toString("base64") } };
}

export function expectStorageBoundary(testCase: StorageBoundaryCase): void {
  expectNoPlaintextPersisted(testCase.persisted, testCase.secrets);
  expectV2Envelope(testCase.persisted, testCase.envelopeField);

  // Authorized read: the persisted content opens for the record it belongs to.
  expect(testCase.open(testCase.persisted)).not.toBeNull();

  // Tampering is refused.
  expect(testCase.open(tamperEnvelope(testCase.persisted, testCase.envelopeField))).toBeNull();

  // Cross-record substitution is refused.
  expect(testCase.openAsOtherRecord(testCase.persisted)).toBeNull();

  // Missing key fails closed: an error, never a plaintext fallback.
  expect(() => testCase.openWithoutKey(testCase.persisted)).toThrow();
}

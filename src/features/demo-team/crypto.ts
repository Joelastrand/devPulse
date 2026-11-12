import { decryptRecord, encryptRecord } from "../../lib/encryption/record-envelope";
import type { DemoCrypto } from "./preflight";

/**
 * The repository's record-envelope cipher (v2), behind the preflight's crypto seam. Every demo collection with business
 * content is sealed with it, bound to its record context. The key is read from `ENCRYPTION_KEY` at call time; nothing here
 * touches or stores key material.
 */
export const demoCrypto: DemoCrypto = {
  sealRecord: (plaintext, context) => encryptRecord(plaintext, context),
  openRecord: (envelope, context) => decryptRecord(envelope, context),
};

import { decrypt, encrypt } from "../../lib/encryption/encryption";
import type { DemoCrypto } from "./preflight";

/**
 * The repository's own AES-256-GCM implementation, unchanged, behind the
 * preflight's crypto seam. The key is read from `ENCRYPTION_KEY` by
 * `encryption.ts` at call time; nothing here touches or stores key material.
 */
export const demoCrypto: DemoCrypto = { encrypt, decrypt };

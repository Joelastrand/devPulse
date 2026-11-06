import "server-only";
import { isActiveSuperadmin, parseSuperadminRecord } from "../domain/superadmin-registry";
import { getDefaultSuperadminStore, type SuperadminStore } from "./superadmin-store";

/**
 * The single server-side superadmin lookup: is this Firebase Auth UID an active registry record right now?
 *
 * Read on every call from the Admin SDK; never cached and never derived from a token claim, cookie, client flag or
 * email address, so a revocation takes effect on the next privileged request. A read failure throws, and callers must
 * treat that as a failed authorization (fail closed), never as "not a superadmin" that a retry could silently change.
 */
export async function readSuperadminActive(uid: string, store: SuperadminStore = getDefaultSuperadminStore()): Promise<boolean> {
  const raw = await store.readRecord(uid);
  return isActiveSuperadmin(parseSuperadminRecord(raw, uid));
}

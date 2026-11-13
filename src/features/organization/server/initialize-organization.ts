import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  buildOrganizationRecord,
  isCanonicalOrganization,
  ORGANIZATION_COLLECTION,
  ORGANIZATION_ID,
} from "../domain/organization";

/**
 * Idempotent initialization of the `nve` organization record (docs/DATA-MODEL.md, "Organization").
 *
 * - No record: create it, once, with `createIfAbsent` (a Firestore create, which fails if the document already exists).
 * - Canonical record already present: `already_initialized`, nothing written.
 * - Any other record at that path: `conflict`, nothing written. A different record is never overwritten silently.
 *
 * Writes only `organizations/nve`. It creates no superadmin, team, membership or survey data.
 */

export interface OrganizationStorePort {
  /** The stored document at the organization path, or `undefined` when there is none. */
  read(): Promise<unknown | undefined>;
  /** Creates the record only if no document exists at the path. Returns `false` when one appeared in the meantime. */
  createIfAbsent(record: ReturnType<typeof buildOrganizationRecord>): Promise<boolean>;
}

/** `would_create` is a dry run (nothing written). `raced` means another writer created a different record first. */
export type InitializeOrganizationOutcome =
  | "would_create"
  | "created"
  | "already_initialized"
  | "conflict"
  | "raced";

export interface InitializeOrganizationOptions {
  readonly apply: boolean;
  readonly now: Date;
}

/** The decision, separated from the store so it is tested without Firestore. */
export async function initializeOrganization(
  store: OrganizationStorePort,
  options: InitializeOrganizationOptions,
): Promise<InitializeOrganizationOutcome> {
  const existing = await store.read();
  if (existing !== undefined) {
    return isCanonicalOrganization(existing) ? "already_initialized" : "conflict";
  }
  if (!options.apply) return "would_create";

  const created = await store.createIfAbsent(buildOrganizationRecord(options.now));
  if (created) return "created";

  // Another writer created the document between the read and the create. Report it; do not overwrite.
  const after = await store.read();
  return after !== undefined && isCanonicalOrganization(after) ? "already_initialized" : "raced";
}

/** Production store: the Admin SDK at `organizations/nve`. Used only by the operator CLI and by tests of the wiring. */
export function firestoreOrganizationStore(): OrganizationStorePort {
  const ref = getFirestoreDb().collection(ORGANIZATION_COLLECTION).doc(ORGANIZATION_ID);
  return {
    async read() {
      const snapshot = await ref.get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async createIfAbsent(record) {
      return getFirestoreDb().runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (snapshot.exists) return false;
        tx.create(ref, record);
        return true;
      });
    },
  };
}

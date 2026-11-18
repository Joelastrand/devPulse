import "server-only";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { runFencedTransaction } from "../../auth/server/erasure-write-fence";
import type { SelfAssessedLevel } from "../domain/self-assessed-level";
import { classifySkillLevelSeed, type SkillSeedAction } from "../domain/skill-level-seed";
import { openSkillLevels, openSkillProfileDocument, sealSkillLevel } from "./skill-level-codec";

const SKILL_PROFILES_COLLECTION = "skillProfiles";
const SKILL_TREES_COLLECTION = "skillTrees";

/** Timestamps a mutation writes; `createdAt` is set only when it must be created or repaired (SPEC BR-10). */
export interface SkillProfileStamps {
  updatedAt: Date;
  createdAt?: Date;
}

/**
 * One transaction over the caller's own profile document. All reads must
 * precede the (buffered) mutations. The only mutations offered are per-key:
 * there is deliberately no way to replace the `levels` map or the document, so
 * unrelated keys and unknown top-level fields always survive (SPEC BR-12/16).
 */
export interface SkillProfileTransaction {
  /** Raw, unvalidated profile data, or `undefined` when the document is absent. */
  readProfile(): Promise<Record<string, unknown> | undefined>;
  /** Raw `skillTrees/{treeId}` data read directly (not via the catalog window), or `undefined` when absent. */
  readSkillTree(treeId: string): Promise<unknown>;
  /** Per-key merge of `levels.<treeId>` plus timestamps; creates the document if absent. */
  setLevel(treeId: string, level: SelfAssessedLevel, stamps: SkillProfileStamps): void;
  /** Removes only `levels.<treeId>` plus timestamps; only valid for an existing document with that key. */
  removeLevel(treeId: string, stamps: SkillProfileStamps): void;
}

/**
 * The persistence seam for `skillProfiles/{uid}` — satisfied in production by
 * Firestore (Admin SDK, server-only) and by an in-memory fake in tests. Every
 * method is keyed by the caller's own verified `uid`; there is no lookup by
 * any other field and no list operation.
 */
export interface SkillProfileStore {
  /** Raw, unvalidated document data, or `undefined` when the document is absent. */
  read(uid: string): Promise<Record<string, unknown> | undefined>;
  /** Runs `work` in a single transaction on `skillProfiles/{uid}`; Firestore may re-run it on contention. */
  runTransaction<T>(uid: string, work: (tx: SkillProfileTransaction) => Promise<T>): Promise<T>;
  /** Physically deletes `skillProfiles/{uid}` whatever it contains; succeeds when it is absent (SPEC BR-14). */
  delete(uid: string): Promise<void>;
}

/** Thrown when the stored profile differs from the planned levels, or a planned level is missing. Carries no content. */
export class SkillSeedConflictError extends Error {
  constructor() {
    super("skill seed conflict");
    this.name = "SkillSeedConflictError";
  }
}

/**
 * Trusted create-only seed of a person's planned self-assessed levels (feature-owned; reached only from the trusted seed
 * workflow). Each level is sealed by `sealSkillLevel` with `skill-profile:<uid>:<treeId>` AAD. The write runs in the
 * erasure-fenced transaction and creates the profile only when it is absent.
 */
export async function seedSkillLevelsCreateOnly(
  uid: string,
  planned: readonly { treeId: string; level: SelfAssessedLevel }[],
  stamps: { createdAt: Date; updatedAt: Date },
): Promise<SkillSeedAction> {
  const db = getFirestoreDb();
  const ref = db.collection(SKILL_PROFILES_COLLECTION).doc(uid);
  return runFencedTransaction(db, uid, async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.exists ? (snapshot.data() ?? {}) : undefined;
    const stored = data?.levels;
    const opened = typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? openSkillLevels(uid, stored as Record<string, unknown>)
      : {};
    const decision = classifySkillLevelSeed(data !== undefined, opened, planned);
    if (decision === "conflict") throw new SkillSeedConflictError();
    if (decision === "create") {
      const levels = Object.fromEntries(planned.map(({ treeId, level }) => [treeId, sealSkillLevel(uid, treeId, level)]));
      tx.create(ref, { levels, createdAt: stamps.createdAt, updatedAt: stamps.updatedAt });
    }
    return decision;
  });
}

/** Maximum document refs per Firestore `getAll` call made by {@link readSkillProfilesBatch}. */
export const SKILL_PROFILE_READ_CHUNK_SIZE = 100;

// Ids Firestore would reject; skipped so one corrupt id neither fails the batch nor widens it.
function isReadableDocumentId(uid: string): boolean {
  return uid.length > 0 && !uid.includes("/") && uid !== "." && uid !== ".." && !/^__.*__$/.test(uid);
}

/**
 * Narrow, read-only server primitive: the raw documents of exactly the supplied
 * uids, fetched by document id with `getAll` in chunks. Deliberately NOT part of
 * {@link SkillProfileStore}, so no owner operation can reach it. It never queries
 * or scans the collection and never writes or repairs. Entries are raw and
 * unvalidated (`undefined` = absent) and carry no uid; their order is not
 * meaningful. Its single intended consumer is `read-skill-levels-batch.ts`.
 * A Firestore failure rejects so the caller can fail closed.
 */
export async function readSkillProfilesBatch(uids: readonly string[]): Promise<Array<Record<string, unknown> | undefined>> {
  const readable = uids.filter(isReadableDocumentId);
  if (readable.length === 0) return [];
  const db = getFirestoreDb();
  const chunks: string[][] = [];
  for (let start = 0; start < readable.length; start += SKILL_PROFILE_READ_CHUNK_SIZE) {
    chunks.push(readable.slice(start, start + SKILL_PROFILE_READ_CHUNK_SIZE));
  }
  const snapshotChunks = await Promise.all(
    chunks.map((chunk) => db.getAll(...chunk.map((uid) => db.collection(SKILL_PROFILES_COLLECTION).doc(uid)))),
  );
  // Levels are opened per owner: the record context includes the uid, so each document is opened with its own id.
  return snapshotChunks.flatMap((snapshots, chunkIndex) =>
    snapshots.map((snapshot, index) => {
      const uid = chunks[chunkIndex][index];
      return openSkillProfileDocument(uid, snapshot.exists ? snapshot.data() : undefined);
    }),
  );
}

export function getDefaultSkillProfileStore(): SkillProfileStore {
  return {
    async read(uid) {
      const snapshot = await getFirestoreDb().collection(SKILL_PROFILES_COLLECTION).doc(uid).get();
      return openSkillProfileDocument(uid, snapshot.exists ? snapshot.data() : undefined);
    },
    async delete(uid) {
      const db = getFirestoreDb();
      const profileRef = db.collection(SKILL_PROFILES_COLLECTION).doc(uid);
      // The erasure fence is read first, in the same transaction (TASK-025, BR-4(b)).
      await runFencedTransaction(db, uid, async (tx) => {
        tx.delete(profileRef);
      });
    },
    async runTransaction(uid, work) {
      const db = getFirestoreDb();
      const profileRef = db.collection(SKILL_PROFILES_COLLECTION).doc(uid);
      // The fence read precedes every read and buffered mutation of `work` (TASK-025, BR-4(b)).
      return runFencedTransaction(db, uid, async (tx) =>
        work({
          async readProfile() {
            const snapshot = await tx.get(profileRef);
            return openSkillProfileDocument(uid, snapshot.exists ? snapshot.data() : undefined);
          },
          async readSkillTree(treeId) {
            const snapshot = await tx.get(db.collection(SKILL_TREES_COLLECTION).doc(treeId));
            return snapshot.exists ? snapshot.data() : undefined;
          },
          setLevel(treeId, level, stamps) {
            // Nested merge-set: only `levels.<treeId>` is touched (tree ids contain no dots).
            // The level is sealed as its own record envelope; the plaintext number is never written.
            tx.set(profileRef, { levels: { [treeId]: sealSkillLevel(uid, treeId, level) }, ...stamps }, { merge: true });
          },
          removeLevel(treeId, stamps) {
            tx.update(
              profileRef,
              new FieldPath("levels", treeId),
              FieldValue.delete(),
              "updatedAt",
              stamps.updatedAt,
              ...(stamps.createdAt ? ["createdAt", stamps.createdAt] : []),
            );
          },
        }),
      );
    },
  };
}

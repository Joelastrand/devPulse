import type { Firestore } from "firebase-admin/firestore";
import type { SeedDatabase, SeedDocument, SeedRef } from "./live";

/**
 * Binds an Admin Firestore client to the seeder's narrow database interface. Shared by the CLI and the emulator suite, so
 * both exercise the same transaction and read calls. Reads and transaction operations only touch the documents named by the
 * seeder's plan, and the one catalog query is limited to `teamSkills` of the given team.
 */
export function bindAdminFirestore(db: Firestore): SeedDatabase {
  return {
    doc: (path): SeedRef => ({ path }),
    get: (ref) => db.doc(ref.path).get(),
    teamSkillsOf: async (teamId): Promise<readonly SeedDocument[]> =>
      (await db.collection("teamSkills").where("teamId", "==", teamId).get()).docs.map((doc) => ({
        id: doc.id,
        data: () => doc.data(),
      })),
    runTransaction: (work) =>
      db.runTransaction((tx) =>
        work({
          get: (ref) => tx.get(db.doc(ref.path)),
          create: (ref, data) => tx.create(db.doc(ref.path), data),
          update: (ref, data) => tx.update(db.doc(ref.path), data),
        }),
      ),
  };
}

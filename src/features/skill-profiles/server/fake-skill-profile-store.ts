import type { SkillProfileStore, SkillProfileTransaction } from "./skill-profile-store";

type Doc = Record<string, unknown>;

/**
 * In-memory `SkillProfileStore` for tests. Mutations are buffered and applied
 * at commit onto the document's *current* state as per-key operations, so two
 * overlapping transactions on different keys both survive, exactly as with
 * Firestore's merge-set / field-path update (no retry loop is modelled).
 */
export function createFakeSkillProfileStore(
  profiles: Record<string, Doc> = {},
  skillTrees: Record<string, unknown> = {},
) {
  const docs = new Map<string, Doc>(Object.entries(profiles).map(([uid, doc]) => [uid, { ...doc }]));
  const writes: Array<{ uid: string; op: "set" | "remove"; treeId: string }> = [];
  const treeReads: string[] = [];
  /** Uids passed to physical document deletion, in call order (absent documents included). */
  const deletes: string[] = [];

  const store: SkillProfileStore = {
    async delete(uid) {
      deletes.push(uid);
      docs.delete(uid);
    },
    async read(uid) {
      const doc = docs.get(uid);
      return doc && { ...doc };
    },
    async runTransaction(uid, work) {
      const pending: Array<() => void> = [];
      const tx: SkillProfileTransaction = {
        async readProfile() {
          const doc = docs.get(uid);
          return doc && { ...doc };
        },
        async readSkillTree(treeId) {
          treeReads.push(treeId);
          return skillTrees[treeId];
        },
        setLevel(treeId, level, stamps) {
          pending.push(() => {
            const doc = docs.get(uid) ?? {};
            const levels = { ...((doc.levels as Doc | undefined) ?? {}), [treeId]: level };
            docs.set(uid, { ...doc, levels, ...stamps });
            writes.push({ uid, op: "set", treeId });
          });
        },
        removeLevel(treeId, stamps) {
          pending.push(() => {
            const doc = docs.get(uid);
            if (!doc) throw new Error("update of a missing document");
            const levels = { ...(doc.levels as Doc) };
            delete levels[treeId];
            docs.set(uid, { ...doc, levels, ...stamps });
            writes.push({ uid, op: "remove", treeId });
          });
        },
      };
      const result = await work(tx);
      for (const apply of pending) apply();
      return result;
    },
  };

  return { store, docs, writes, treeReads, deletes };
}

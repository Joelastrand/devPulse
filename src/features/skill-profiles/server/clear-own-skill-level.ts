import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isWellFormedTreeId, readSkillProfileRecord } from "../domain/skill-profile";
import { getDefaultSkillProfileStore, type SkillProfileStore } from "./skill-profile-store";
import { stampsForWrite } from "./write-stamps";

export type ClearOwnSkillLevelResult =
  | { ok: true; level: null }
  | { ok: false; error: "unauthenticated" | "skill_unavailable" | "profile_unreadable" | "persistence_failed" };

export interface ClearOwnSkillLevelDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: SkillProfileStore;
  now?: () => Date;
}

/**
 * Clears the caller's own level for one skill (SPEC BR-13). Idempotent: an
 * absent document or key writes nothing. The tree is not looked up, so stale or
 * hidden entries can be cleared. No request body is ever read.
 */
export async function clearOwnSkillLevel(
  idToken: string,
  treeId: string,
  deps: ClearOwnSkillLevelDeps = {},
): Promise<ClearOwnSkillLevelResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: "unauthenticated" };

  if (!isWellFormedTreeId(treeId)) return { ok: false, error: "skill_unavailable" };

  const store = deps.store ?? getDefaultSkillProfileStore();
  const now = (deps.now ?? (() => new Date()))();

  try {
    return await store.runTransaction<ClearOwnSkillLevelResult>(verified.identity.uid, async (tx) => {
      const existing = await tx.readProfile();
      const record = readSkillProfileRecord(existing);
      if (!record.readable) return { ok: false, error: "profile_unreadable" };

      if (existing !== undefined && Object.hasOwn(record.levels, treeId)) {
        tx.removeLevel(treeId, stampsForWrite(existing, now));
      }
      return { ok: true, level: null };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

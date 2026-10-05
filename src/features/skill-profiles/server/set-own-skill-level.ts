import "server-only";
import { isValidSkillTree } from "../../skill-trees/domain/skill-tree";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isSelfAssessedLevel, type SelfAssessedLevel } from "../domain/self-assessed-level";
import { isWellFormedTreeId, readSkillProfileRecord } from "../domain/skill-profile";
import { toCandidateSkillTree } from "./skill-catalog";
import { getDefaultSkillProfileStore, type SkillProfileStore } from "./skill-profile-store";
import { stampsForWrite } from "./write-stamps";

export type SetOwnSkillLevelResult =
  | { ok: true; level: SelfAssessedLevel }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "invalid_request"
        | "invalid_input"
        | "skill_unavailable"
        | "profile_unreadable"
        | "persistence_failed";
    };

export interface SetOwnSkillLevelDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: SkillProfileStore;
  now?: () => Date;
}

/**
 * Sets the caller's own level for one skill (SPEC BR-12). `body` is the parsed
 * JSON body, or `undefined` when it was missing or malformed. The target tree
 * is validated by reading its own document inside the transaction — never via
 * the bounded catalog window — and only that map key plus timestamps is written.
 */
export async function setOwnSkillLevel(
  idToken: string,
  treeId: string,
  body: unknown,
  deps: SetOwnSkillLevelDeps = {},
): Promise<SetOwnSkillLevelResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: "unauthenticated" };

  if (!isWellFormedTreeId(treeId)) return { ok: false, error: "skill_unavailable" };

  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_request" };
  const keys = Object.keys(body);
  const level = (body as Record<string, unknown>).level;
  if (Array.isArray(body) || keys.length !== 1 || keys[0] !== "level" || !isSelfAssessedLevel(level)) {
    return { ok: false, error: "invalid_input" };
  }

  const store = deps.store ?? getDefaultSkillProfileStore();
  const now = (deps.now ?? (() => new Date()))();

  try {
    return await store.runTransaction<SetOwnSkillLevelResult>(verified.identity.uid, async (tx) => {
      const existing = await tx.readProfile();
      if (!readSkillProfileRecord(existing).readable) return { ok: false, error: "profile_unreadable" };

      const tree = await tx.readSkillTree(treeId);
      if (!isValidSkillTree(toCandidateSkillTree(tree))) return { ok: false, error: "skill_unavailable" };

      tx.setLevel(treeId, level, stampsForWrite(existing, now));
      return { ok: true, level };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

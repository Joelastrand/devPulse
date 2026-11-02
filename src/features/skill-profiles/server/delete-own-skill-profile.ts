import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { getDefaultSkillProfileStore, type SkillProfileStore } from "./skill-profile-store";
import { type AuthRefusal, authRefusalFor } from "../../auth/server/auth-refusal";
import { writeRefusalFor } from "../../auth/server/erasure-write-fence";

export type DeleteOwnSkillProfileResult =
  | { ok: true }
  | { ok: false; error: AuthRefusal | "persistence_failed" };

export interface DeleteOwnSkillProfileDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: SkillProfileStore;
}

/**
 * Erases the caller's whole skill profile (SPEC BR-14) by physically deleting
 * `skillProfiles/{uid}`. The document is never read or interpreted, so an
 * unreadable profile is recovered too; no timestamp is written, the catalog is
 * not consulted, and no request body is read. Idempotent when absent.
 */
export async function deleteOwnSkillProfile(
  idToken: string,
  deps: DeleteOwnSkillProfileDeps = {},
): Promise<DeleteOwnSkillProfileResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };

  const store = deps.store ?? getDefaultSkillProfileStore();

  try {
    await store.delete(verified.identity.uid);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

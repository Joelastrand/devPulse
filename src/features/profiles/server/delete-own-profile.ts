import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { getDefaultUserProfileStore, type UserProfileStore } from "./user-profile-store";

export type DeleteOwnProfileResult =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "persistence_failed" };

export interface DeleteOwnProfileDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: UserProfileStore;
}

/**
 * Hard-deletes the caller's own `userProfiles` document (docs/features/
 * member-identity-and-team-roles/SPEC.md — BR-3). Idempotent. This removes
 * only the display name — it is not account deletion and never touches the
 * Firebase Auth account or any other collection.
 */
export async function deleteOwnProfile(
  idToken: string,
  deps: DeleteOwnProfileDeps = {},
): Promise<DeleteOwnProfileResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const store = deps.store ?? getDefaultUserProfileStore();
  try {
    await store.remove(verified.identity.uid);
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

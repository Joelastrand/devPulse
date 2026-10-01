import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isValidUserProfile } from "../domain/user-profile";
import { getDefaultUserProfileStore, type UserProfileStore } from "./user-profile-store";

export type GetOwnProfileResult =
  | { ok: true; displayName: string | null }
  | { ok: false; error: "unauthenticated" | "persistence_failed" };

export interface GetOwnProfileDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: UserProfileStore;
}

/**
 * Returns the caller's own display name, or `null` when none is set or the
 * stored document is invalid (docs/features/member-identity-and-team-roles/
 * SPEC.md — BR-1, BR-7). The `uid` comes exclusively from the verified ID
 * token; no `uid` parameter exists. Never falls back to e-mail or any other
 * identity value when no name is set.
 */
export async function getOwnProfile(
  idToken: string,
  deps: GetOwnProfileDeps = {},
): Promise<GetOwnProfileResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const store = deps.store ?? getDefaultUserProfileStore();
  try {
    const raw = await store.read(verified.identity.uid);
    return { ok: true, displayName: isValidUserProfile(raw) ? raw.displayName : null };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

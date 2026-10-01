import "server-only";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { normalizeDisplayName } from "../domain/display-name";
import { isValidUserProfile } from "../domain/user-profile";
import { getDefaultUserProfileStore, type UserProfileStore } from "./user-profile-store";

export type SetOwnProfileResult =
  | { ok: true; displayName: string }
  | { ok: false; error: "unauthenticated" | "invalid_input" | "persistence_failed" };

export interface SetOwnProfileDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  store?: UserProfileStore;
}

/**
 * Creates or replaces the caller's own display name (docs/features/
 * member-identity-and-team-roles/SPEC.md — BR-2, BR-4). Authentication is
 * checked first, then the candidate name is normalised/validated; the
 * normalised value is what is stored and returned. `createdAt` is preserved
 * from an existing valid document; `updatedAt` is the server clock. The
 * `uid` is the verified token's `uid` only.
 */
export async function setOwnProfile(
  idToken: string,
  displayName: unknown,
  deps: SetOwnProfileDeps = {},
): Promise<SetOwnProfileResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const normalized = normalizeDisplayName(displayName);
  if (!normalized.ok) {
    return { ok: false, error: "invalid_input" };
  }

  const now = deps.now ?? new Date();
  const store = deps.store ?? getDefaultUserProfileStore();
  try {
    await store.upsert(verified.identity.uid, (existing) => ({
      displayName: normalized.displayName,
      createdAt: isValidUserProfile(existing) ? existing.createdAt : now,
      updatedAt: now,
    }));
    return { ok: true, displayName: normalized.displayName };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

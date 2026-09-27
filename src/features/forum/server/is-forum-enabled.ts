import "server-only";

export interface IsForumEnabledDeps {
  value?: string;
}

/**
 * Server-only product/UI availability switch for the Forum feature, read
 * from `FEATURE_FORUM_ENABLED` at call time. This is a UI-availability flag,
 * not a security control: Forum's existing server-side authorization,
 * encryption, and API routes (`src/features/forum/server/`,
 * `app/api/teams/[teamId]/forum/...`) are unaffected by this value and
 * remain active regardless of it (docs/features/team-forum/SPEC.md —
 * "Feature flag").
 *
 * Fails closed: only the exact string `"true"` enables the Forum UI; a
 * missing, empty, `"false"`, or any other value disables it. Never exposed
 * to client code (no `NEXT_PUBLIC_*` counterpart exists).
 */
export function isForumEnabled(deps: IsForumEnabledDeps = {}): boolean {
  const raw = deps.value ?? process.env.FEATURE_FORUM_ENABLED;
  return raw === "true";
}

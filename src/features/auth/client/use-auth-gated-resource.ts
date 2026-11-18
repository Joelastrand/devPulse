"use client";

import { useCallback, useEffect, useRef } from "react";
import { observeIdToken } from "./auth-client";

type IsCurrentGeneration = (generation: number) => boolean;

/**
 * What changed in the authentication state, derived from the Firebase account UID (never from token contents):
 * - `signed_in`: first sign-in, or sign-in after sign-out.
 * - `refreshed`: the same account received a new ID token. Drafts and other unsaved state may be kept.
 * - `switched`: a different account is now signed in, with no sign-out in between. Account-scoped state must be dropped.
 * - `signed_out`: no account. Account-scoped state must be dropped.
 * An emission whose UID is unknown is treated as `switched` (fail closed).
 */
export type AuthChange = "signed_in" | "refreshed" | "switched" | "signed_out";

/**
 * Shared implementation of the `observeIdToken` + monotonic-generation
 * stale-response guard previously duplicated verbatim across
 * `TeamsOverview`, `TeamDetail`, `AdminTeams`, `AdminTeamDetail`, and
 * `ResultsRedirect`.
 *
 * Subscribes to `observeIdToken`. Every auth-state change (sign-out,
 * account switch, or token refresh) — and unmount — bumps a monotonic
 * generation counter, then `onAuthChange` is invoked with the current
 * token, the generation it belongs to, and `isCurrentGeneration` itself
 * (also returned, for use outside the callback, e.g. from a later mutation
 * handler). The caller owns everything else: its own loading/signed-out/
 * error/domain state, and any async continuation it starts, checking
 * `isCurrentGeneration` before applying a result so a response belonging to
 * a superseded auth state (or an unmounted/torn-down instance) is never
 * applied.
 *
 * `resetDeps` lets a caller add extra invalidation triggers beyond auth
 * state itself (e.g. a route's `teamId`) — a change in any of them tears
 * down and re-establishes the subscription exactly like an auth change
 * would, bumping the generation and discarding whatever was in flight for
 * the previous value.
 */
export function useAuthGatedResource(
  onAuthChange: (
    token: string | null,
    generation: number,
    isCurrentGeneration: IsCurrentGeneration,
    change: AuthChange,
  ) => void,
  resetDeps: readonly unknown[] = [],
): { isCurrentGeneration: IsCurrentGeneration } {
  const generationRef = useRef(0);
  /** UID of the last signed-in account. `undefined` before the first emission; `null` after sign-out. */
  const lastUidRef = useRef<string | null | undefined>(undefined);
  const onAuthChangeRef = useRef(onAuthChange);

  useEffect(() => {
    onAuthChangeRef.current = onAuthChange;
  }, [onAuthChange]);

  const isCurrentGeneration = useCallback((generation: number): boolean => {
    return generationRef.current === generation;
  }, []);

  useEffect(() => {
    const unsubscribe = observeIdToken((token, uid, signal) => {
      generationRef.current += 1;
      if (signal === "account_changing") {
        // Early invalidation: the previous account's state is dropped now. `lastUidRef` keeps the previous UID so the
        // new account's delivery is still classified as `switched` (drafts cleared), not `signed_in`.
        onAuthChangeRef.current(null, generationRef.current, isCurrentGeneration, "switched");
        return;
      }
      const previous = lastUidRef.current;
      let change: AuthChange;
      if (token === null) change = "signed_out";
      else if (uid === null) change = "switched";
      else if (previous === undefined || previous === null) change = "signed_in";
      else change = previous === uid ? "refreshed" : "switched";
      lastUidRef.current = token === null ? null : uid;
      onAuthChangeRef.current(token, generationRef.current, isCurrentGeneration, change);
    });

    return () => {
      // Invalidates any request still in flight for this subscription —
      // fires on unmount and, because `resetDeps` may include route state,
      // on every route change too.
      generationRef.current += 1;
      unsubscribe();
    };
    // `resetDeps` is caller-supplied and deliberately drives resubscription;
    // `onAuthChangeRef`/`isCurrentGeneration` are stable and exempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...resetDeps]);

  return { isCurrentGeneration };
}

"use client";

import { useCallback, useEffect, useRef } from "react";
import { observeIdToken } from "./auth-client";

type IsCurrentGeneration = (generation: number) => boolean;

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
  ) => void,
  resetDeps: readonly unknown[] = [],
): { isCurrentGeneration: IsCurrentGeneration } {
  const generationRef = useRef(0);
  const onAuthChangeRef = useRef(onAuthChange);

  useEffect(() => {
    onAuthChangeRef.current = onAuthChange;
  }, [onAuthChange]);

  const isCurrentGeneration = useCallback((generation: number): boolean => {
    return generationRef.current === generation;
  }, []);

  useEffect(() => {
    const unsubscribe = observeIdToken((token) => {
      generationRef.current += 1;
      onAuthChangeRef.current(token, generationRef.current, isCurrentGeneration);
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

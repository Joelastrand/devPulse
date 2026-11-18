"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSystemFavorites, setSystemFavorite, type FavoriteWriteError } from "./system-favorites-gateway";

/**
 * The caller's favorites in one team: loaded once per token and team, and changed one system at a time.
 *
 * - A toggle shows only as pending until the server confirms it. The favorite set changes on a confirmed write, never before.
 * - A system with a write in flight ignores further toggles, so a double click sends one request.
 * - A late answer after unmount is dropped. The owning component is keyed by token and team, so an account or team switch
 *   unmounts it and any response from the previous account cannot land in the new one.
 */

export type FavoritesLoad =
  | { status: "loading" }
  | { status: "ready"; ids: ReadonlySet<string> }
  | { status: "error" };

export interface SystemFavoritesState {
  load: FavoritesLoad;
  pendingIds: ReadonlySet<string>;
  /** The last refused toggle, so the UI can name the failure next to the system. Cleared by the next toggle. */
  failure: { systemId: string; error: FavoriteWriteError } | null;
  toggle: (systemId: string, favorite: boolean) => Promise<void>;
}

export function useSystemFavorites(token: string, teamId: string): SystemFavoritesState {
  const [load, setLoad] = useState<FavoritesLoad>({ status: "loading" });
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<SystemFavoritesState["failure"]>(null);
  const inFlight = useRef<Set<string>>(new Set());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    fetchSystemFavorites(token, teamId).then((result) => {
      if (cancelled) return;
      setLoad(result.status === "ok" ? { status: "ready", ids: new Set(result.systemIds) } : { status: "error" });
    });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [token, teamId]);

  const toggle = useCallback(
    async (systemId: string, favorite: boolean) => {
      if (inFlight.current.has(systemId)) return;
      inFlight.current.add(systemId);
      setPendingIds(new Set(inFlight.current));
      setFailure(null);

      const result = await setSystemFavorite(token, teamId, systemId, favorite);
      inFlight.current.delete(systemId);
      if (!alive.current) return;
      setPendingIds(new Set(inFlight.current));

      if (!result.ok) {
        setFailure({ systemId, error: result.error });
        return;
      }
      setLoad((current) => {
        if (current.status !== "ready") return current;
        const ids = new Set(current.ids);
        if (result.favorite) ids.add(systemId);
        else ids.delete(systemId);
        return { status: "ready", ids };
      });
    },
    [token, teamId],
  );

  return { load, pendingIds, failure, toggle };
}

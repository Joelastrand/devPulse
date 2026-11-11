"use client";

import { useCallback, useRef, useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import type { GatewayError, GatewayResult } from "./records-gateway";

export type OwnerRecordsState<T> =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "error"; error: GatewayError }
  | { phase: "ready"; data: T };

type Fetcher<T> = (token: string) => Promise<GatewayResult<T>>;

/**
 * Loads one owner-scoped list through a gateway and keeps it fresh (the signed-in person's own records only). A response
 * from a superseded auth state is discarded (the same generation guard as the other client resources). After each
 * successful mutation the list is reloaded from the canonical `GET`, never patched locally.
 */
export function useOwnerRecords<T>(fetcher: Fetcher<T>) {
  const [state, setState] = useState<OwnerRecordsState<T>>({ phase: "loading" });
  const tokenRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(
    async (token: string, generation: number, isCurrent: (generation: number) => boolean) => {
      const result = await fetcher(token);
      if (!isCurrent(generation)) return;
      if (result.ok) setState({ phase: "ready", data: result.value });
      else if (result.error === "unauthenticated") setState({ phase: "signed_out" });
      else setState({ phase: "error", error: result.error });
    },
    [fetcher],
  );

  const { isCurrentGeneration } = useAuthGatedResource((token, generation, isCurrent) => {
    tokenRef.current = token;
    generationRef.current = generation;
    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }
    setState({ phase: "loading" });
    void load(token, generation, isCurrent);
  });

  /** Reloads the canonical list with the current token. Used on retry and after a successful mutation. */
  const reload = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    setState((previous) => (previous.phase === "ready" ? previous : { phase: "loading" }));
    await load(token, generationRef.current, isCurrentGeneration);
  }, [load, isCurrentGeneration]);

  /**
   * Runs one mutation with the current token. Returns the gateway result for the form to show; on success the list is reloaded.
   */
  const mutate = useCallback(
    async <R>(action: (token: string) => Promise<GatewayResult<R>>): Promise<GatewayResult<R>> => {
      const token = tokenRef.current;
      if (!token) return { ok: false, error: "unauthenticated" };
      const result = await action(token);
      if (result.ok) await reload();
      else if (result.error === "unauthenticated") setState({ phase: "signed_out" });
      return result;
    },
    [reload],
  );

  return { state, reload, mutate };
}

export type OwnerRecords<T> = ReturnType<typeof useOwnerRecords<T>>;

/** Narrows a loaded list state, so components render data only in the ready phase. */
export function isReady<T>(records: OwnerRecordsState<T>): records is { phase: "ready"; data: T } {
  return records.phase === "ready";
}

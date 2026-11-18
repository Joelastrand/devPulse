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

/** `superseded`: the auth state changed during the write, so its result must not be shown as success or failure. */
export type MutationOutcome<R> = { status: "done"; result: GatewayResult<R> } | { status: "superseded" };

/**
 * Loads one owner-scoped list through a gateway and keeps it fresh (the signed-in person's own records only). A response
 * from a superseded auth state is discarded (the same generation guard as the other client resources). After each
 * successful mutation the list is reloaded from the canonical `GET`, never patched locally.
 */
export function useOwnerRecords<T>(fetcher: Fetcher<T>) {
  const [state, setState] = useState<OwnerRecordsState<T>>({ phase: "loading" });
  const [authEpoch, setAuthEpoch] = useState(0);
  const [accountEpoch, setAccountEpoch] = useState(0);
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

  const { isCurrentGeneration } = useAuthGatedResource((token, generation, isCurrent, change) => {
    tokenRef.current = token;
    generationRef.current = generation;
    // Every auth change, including a token refresh, bumps `authEpoch`: callers drop transient messages and open
    // confirmations. Only a real account change or sign-out bumps `accountEpoch`: callers drop account-scoped drafts. A
    // refresh for the same account keeps the draft.
    setAuthEpoch((current) => current + 1);
    if (change === "switched" || change === "signed_out") setAccountEpoch((current) => current + 1);
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
   * Runs one mutation with the current token. On success the canonical list is reloaded. If the auth generation changed while
   * the write was in flight (sign-out, account switch, or a token refresh), the outcome is `superseded`: the caller must show
   * neither success nor failure, because the write may have completed on the server. The canonical list is re-read for the
   * current state instead, so the view shows what the server now holds.
   */
  const mutate = useCallback(
    async <R>(action: (token: string) => Promise<GatewayResult<R>>): Promise<MutationOutcome<R>> => {
      const token = tokenRef.current;
      if (!token) return { status: "done", result: { ok: false, error: "unauthenticated" } };
      const generation = generationRef.current;
      const result = await action(token);
      if (generation !== generationRef.current) {
        void reload();
        return { status: "superseded" };
      }
      if (result.ok) await reload();
      else if (result.error === "unauthenticated") setState({ phase: "signed_out" });
      return { status: "done", result };
    },
    [reload],
  );

  return { state, reload, mutate, authEpoch, accountEpoch };
}

export type OwnerRecords<T> = ReturnType<typeof useOwnerRecords<T>>;

/** Narrows a loaded list state, so components render data only in the ready phase. */
export function isReady<T>(records: OwnerRecordsState<T>): records is { phase: "ready"; data: T } {
  return records.phase === "ready";
}

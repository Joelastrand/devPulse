"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { observeIdToken } from "../../features/auth/client/auth-client";
import {
  fetchTeamsOverview,
  type TeamsOverviewFetchResult,
} from "../../features/teams/client/teams-overview-gateway";

/**
 * Team name shown as context in the shell on team routes
 * (docs/archive/features/product-experience/SPEC.md — Application shell). The team page
 * already loads the name, and it announces it here. No request is made for it.
 *
 * `loadTeamsOverview` shares one `/teams` overview read per signed-in session between the team page headers that
 * need a name. It is a display cache only: the overview never authorizes anything (TeamDetail still asks the results
 * endpoint), so a stale entry can at worst show an old name. Entries are keyed by the exact ID token, so a sign-in,
 * account switch or token refresh never reuses another identity's read, and a sign-out clears it. Failed reads are
 * not kept, so the next mount retries.
 */
interface TeamContextValue {
  teamName: string | null;
  setTeamName: (name: string | null) => void;
  loadTeamsOverview: (idToken: string) => Promise<TeamsOverviewFetchResult>;
}

interface OverviewEntry {
  readonly token: string;
  readonly promise: Promise<TeamsOverviewFetchResult>;
}

const TeamContext = createContext<TeamContextValue | null>(null);

export function TeamContextProvider({ children }: { children: ReactNode }) {
  const [teamName, setTeamName] = useState<string | null>(null);
  const overviewRef = useRef<OverviewEntry | null>(null);

  useEffect(
    () =>
      observeIdToken((token) => {
        if (token === null) {
          overviewRef.current = null;
        }
      }),
    [],
  );

  const loadTeamsOverview = useCallback((idToken: string): Promise<TeamsOverviewFetchResult> => {
    const cached = overviewRef.current;
    if (cached && cached.token === idToken) {
      return cached.promise;
    }
    const entry: OverviewEntry = {
      token: idToken,
      promise: fetchTeamsOverview(idToken).then((result) => {
        if (result.status !== "ok" && overviewRef.current === entry) {
          overviewRef.current = null;
        }
        return result;
      }),
    };
    overviewRef.current = entry;
    return entry.promise;
  }, []);

  const value = useMemo(() => ({ teamName, setTeamName, loadTeamsOverview }), [teamName, loadTeamsOverview]);
  return <TeamContext value={value}>{children}</TeamContext>;
}

export function useTeamName(): string | null {
  return useContext(TeamContext)?.teamName ?? null;
}

/**
 * The overview loader for team page headers: the session-shared read inside the shell, or a direct read when the
 * component renders outside the provider (tests, or any future route without the shell).
 */
export function useTeamsOverviewLoader(): (idToken: string) => Promise<TeamsOverviewFetchResult> {
  return useContext(TeamContext)?.loadTeamsOverview ?? ((idToken: string) => fetchTeamsOverview(idToken));
}

/** Announces the team a page is showing. Clears it when the page unmounts. */
export function useAnnounceTeamName(name: string | null) {
  const setTeamName = useContext(TeamContext)?.setTeamName;
  useEffect(() => {
    setTeamName?.(name);
    return () => setTeamName?.(null);
  }, [setTeamName, name]);
}

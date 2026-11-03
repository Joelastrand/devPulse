"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Team name shown as context in the shell on team routes
 * (docs/features/product-experience/SPEC.md — Application shell). The team page
 * already loads the name, and it announces it here. No request is made for it,
 * and it is not stored anywhere.
 */
interface TeamContextValue {
  teamName: string | null;
  setTeamName: (name: string | null) => void;
}

const TeamContext = createContext<TeamContextValue | null>(null);

export function TeamContextProvider({ children }: { children: ReactNode }) {
  const [teamName, setTeamName] = useState<string | null>(null);
  const value = useMemo(() => ({ teamName, setTeamName }), [teamName]);
  return <TeamContext value={value}>{children}</TeamContext>;
}

export function useTeamName(): string | null {
  return useContext(TeamContext)?.teamName ?? null;
}

/** Announces the team a page is showing. Clears it when the page unmounts. */
export function useAnnounceTeamName(name: string | null) {
  const setTeamName = useContext(TeamContext)?.setTeamName;
  useEffect(() => {
    setTeamName?.(name);
    return () => setTeamName?.(null);
  }, [setTeamName, name]);
}

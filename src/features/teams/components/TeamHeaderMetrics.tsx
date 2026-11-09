"use client";

import { useEffect, useState } from "react";
import { fetchTeamSystems } from "../../team-systems/client/team-systems-gateway";
import { completeHeaderCount, type HeaderCountRead } from "../domain/team-oversikt";

/**
 * Header metrics for the team Oversikt (team-experience-redesign, reference 18): system count and competence-area count.
 * The member count is deliberately not shown: the only member-facing roster read is the collapsed roster section, and the
 * Oversikt must not request it on load (TeamDetail test contract). A count appears only when its read is complete, so
 * loading, failed or truncated reads show nothing rather than a placeholder or partial total.
 */
export const TEAM_HEADER_METRIC_COPY = {
  systems: (count: number) => `${count} ${count === 1 ? "system" : "systemer"}`,
  competenceAreas: (count: number) => `${count} ${count === 1 ? "kompetanseområde" : "kompetanseområder"}`,
  label: "Teamets nøkkeltall",
} as const;

interface HeaderReads {
  key: string;
  systems: HeaderCountRead | null;
}

export interface TeamHeaderMetricsProps {
  teamId: string;
  token: string;
  /** Already-loaded skill count; `null` when that read is unavailable. */
  competenceAreas: number | null;
}

export function TeamHeaderMetrics({ teamId, token, competenceAreas }: TeamHeaderMetricsProps) {
  const [reads, setReads] = useState<HeaderReads>({ key: "", systems: null });
  const key = `${teamId}:${token}`;
  const systems = reads.key === key ? completeHeaderCount(reads.systems) : null;

  useEffect(() => {
    let cancelled = false;
    void fetchTeamSystems(token, teamId).then((result) => {
      if (cancelled) return;
      setReads({
        key,
        systems: result.status === "ok" ? { count: result.systems.length, truncated: result.truncated } : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [key, teamId, token]);

  if (systems === null && competenceAreas === null) {
    return null;
  }

  return (
    <ul aria-label={TEAM_HEADER_METRIC_COPY.label} className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-text-secondary">
      {systems !== null && <li>{TEAM_HEADER_METRIC_COPY.systems(systems)}</li>}
      {competenceAreas !== null && <li>{TEAM_HEADER_METRIC_COPY.competenceAreas(competenceAreas)}</li>}
    </ul>
  );
}

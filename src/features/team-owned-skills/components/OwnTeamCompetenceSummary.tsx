"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchTeamsOverview } from "../../teams/client/teams-overview-gateway";
import { skillCatalogCopy } from "../../skill-profiles/copy";
import { fetchTeamSkills, type TeamSkillsListResult } from "../client/team-skills-gateway";
import { assessmentPercent } from "./team-skill-groups";

interface TeamSummaryRow {
  readonly teamId: string;
  readonly name: string;
  /** Counts over the team's active competencies only; inactive ones are not part of the assessment progress. */
  readonly active: number;
  readonly assessed: number;
  readonly failed: boolean;
}

type ViewState = { phase: "loading" } | { phase: "signed_out" } | { phase: "failed" } | { phase: "ready"; rows: readonly TeamSummaryRow[] };

/** Pure: counts one team's active competencies and how many of them the person has rated. */
export function summarizeOwnTeamAssessment(list: Extract<TeamSkillsListResult, { status: "ok" }>): { active: number; assessed: number } {
  const active = list.skills.filter((skill) => skill.active);
  const assessed = active.filter((skill) => list.own.some((rating) => rating.skillId === skill.skillId)).length;
  return { active: active.length, assessed };
}

/**
 * Informational overview of the person's team competencies, one tile per team. It has no primary action (the overview's one
 * primary action lives in its next-steps panel); a subtle text link leads to the view. Counts are never added together
 * across teams, since each team has its own catalog.
 */
export function OwnTeamCompetenceSummary({
  onReady,
}: {
  /** Reports whether any team still has unassessed active competencies. The overview uses it to pick its one primary action. */
  readonly onReady?: (anyTeamIncomplete: boolean) => void;
}) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

  useAuthGatedResource((token, generation, isCurrentGeneration) => {
    if (!token) {
      setState({ phase: "signed_out" });
      return;
    }
    setState({ phase: "loading" });
    void (async () => {
      const overview = await fetchTeamsOverview(token);
      if (!isCurrentGeneration(generation)) return;
      if (overview.status !== "ok") {
        setState({ phase: "failed" });
        return;
      }
      const member = overview.teams.filter((team) => team.isMember);
      const rows = await Promise.all(
        member.map(async (team): Promise<TeamSummaryRow> => {
          const list = await fetchTeamSkills(token, team.teamId);
          if (list.status !== "ok") return { teamId: team.teamId, name: team.name, active: 0, assessed: 0, failed: true };
          return { teamId: team.teamId, name: team.name, ...summarizeOwnTeamAssessment(list), failed: false };
        }),
      );
      if (!isCurrentGeneration(generation)) return;
      setState({ phase: "ready", rows });
      onReady?.(rows.some((row) => !row.failed && row.assessed < row.active));
    })();
  }, []);

  const copy = skillCatalogCopy.team;
  const headingId = "own-team-competence-summary-heading";

  if (state.phase === "signed_out") return null;

  return (
    <Card as="section" padding="sm" aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-base font-semibold text-text-primary">
        {copy.summaryHeading}
      </h2>
      {state.phase === "loading" ? <p className="text-sm text-text-secondary">{copy.summaryLoading}</p> : null}
      {state.phase === "failed" ? <Alert variant="error">{copy.summaryUnavailable}</Alert> : null}
      {state.phase === "ready" && state.rows.length === 0 ? <p className="text-sm text-text-secondary">{copy.summaryNone}</p> : null}
      {state.phase === "ready" && state.rows.length > 0 ? (
        <ul className={state.rows.length > 1 ? "grid gap-3 sm:grid-cols-2" : "flex flex-col"}>
          {state.rows.map((row) => (
            <li key={row.teamId} className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border-subtle p-3">
              <p className="break-words text-sm font-medium text-text-primary">{row.name}</p>
              {row.failed ? (
                <p className="text-sm text-text-secondary">{copy.summaryUnavailable}</p>
              ) : (
                <>
                  <p className="text-sm text-text-secondary">{copy.summaryCounts(row.assessed, row.active)}</p>
                  <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-border-subtle">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${assessmentPercent(row.assessed, row.active)}%` }} />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {state.phase === "ready" && state.rows.length > 0 ? (
        <Link
          href="/me/skills?vy=teamkompetanser"
          className="w-fit text-sm font-medium text-text-primary underline underline-offset-2 hover:text-primary"
        >
          {copy.summaryLink}
        </Link>
      ) : null}
    </Card>
  );
}

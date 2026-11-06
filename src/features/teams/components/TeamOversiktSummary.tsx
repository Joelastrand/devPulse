"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Card } from "../../../components/ui/Card";
import { fetchCompetencePlans } from "../../team-competence-plan/client/competence-plan-gateway";
import { fetchTeamProjects } from "../../team-projects/client/team-projects-gateway";
import { fetchTeamSystems } from "../../team-systems/client/team-systems-gateway";
import {
  buildOversiktNextSteps,
  countActiveProjects,
  countPriorityPlans,
  type OversiktNextStepKind,
} from "../domain/team-oversikt";

/** Norwegian copy for the Oversikt summary (TASK-008, reference 18). No value is invented: unavailable reads say so. */
export const TEAM_OVERSIKT_COPY = {
  openChallenges: "Åpne utfordringer",
  activeProjects: "Pågående prosjekt",
  systemsAttention: "System som trenger oppfølging",
  priorityPlans: "Prioriterte kompetanseplaner",
  loading: "Laster…",
  unavailable: "Kunne ikke lastes",
  forbiddenForMembers: "Kun for teamledere",
  nextStepsHeading: "Neste steg",
  noNextSteps: "Ingen oppfølging nå.",
  goTo: "Gå til",
  /** Tab labels, keyed by the tab route segment that holds the work. */
  links: {
    roadmap: "Roadmap",
    "competence-plan": "Kompetanseplan",
    systems: "Systemoversikt",
  },
  nextStepLabels: {
    systems: (count: number) => `Følg opp ${count} ${count === 1 ? "system" : "systemer"}`,
    "competence-plan": (count: number) => `Gjennomgå ${count} prioriterte ${count === 1 ? "plan" : "planer"}`,
    roadmap: (count: number) => `${count} ${count === 1 ? "prosjekt pågår" : "prosjekter pågår"} i roadmap`,
  },
} as const;

type ReadState = { status: "loading" } | { status: "ok"; value: number } | { status: "forbidden" } | { status: "unavailable" };

interface DerivedReads {
  activeProjects: ReadState;
  systemsAttention: ReadState;
  priorityPlans: ReadState;
}

const LOADING: DerivedReads = {
  activeProjects: { status: "loading" },
  systemsAttention: { status: "loading" },
  priorityPlans: { status: "loading" },
};

export interface TeamOversiktSummaryProps {
  teamId: string;
  token: string;
  /** Open challenge count from the challenges read already loaded by the team page; `null` when that read failed. */
  openChallenges: number | null;
}

/**
 * Four compact KPI cards and up to three `Neste steg` items (TASK-008, SPEC BR-1–BR-4). Each card reads one authorized
 * detail gateway, and each card has its own loading, forbidden and unavailable state, so a failed read never shows a `0`.
 */
export function TeamOversiktSummary({ teamId, token, openChallenges }: TeamOversiktSummaryProps) {
  const [reads, setReads] = useState<{ key: string; value: DerivedReads }>({ key: "", value: LOADING });
  const key = `${teamId}:${token}`;
  const current = reads.key === key ? reads.value : LOADING;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchTeamProjects(token, teamId), fetchTeamSystems(token, teamId), fetchCompetencePlans(token, teamId)]).then(
      ([projects, systems, plans]) => {
        if (cancelled) return;
        setReads({
          key,
          value: {
            activeProjects:
              projects.status === "ok"
                ? { status: "ok", value: countActiveProjects(projects.projects) }
                : projects.status === "forbidden"
                  ? { status: "forbidden" }
                  : { status: "unavailable" },
            systemsAttention:
              systems.status === "ok"
                ? { status: "ok", value: systems.systems.filter((system) => system.attention).length }
                : systems.status === "forbidden"
                  ? { status: "forbidden" }
                  : { status: "unavailable" },
            priorityPlans:
              plans.status === "ok"
                ? { status: "ok", value: countPriorityPlans(plans.plans) }
                : plans.status === "forbidden"
                  ? { status: "forbidden" }
                  : { status: "unavailable" },
          },
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, teamId, token]);

  const nextSteps = buildOversiktNextSteps({
    systemsNeedingAttention: current.systemsAttention.status === "ok" ? current.systemsAttention.value : null,
    priorityPlans: current.priorityPlans.status === "ok" ? current.priorityPlans.value : null,
    activeProjects: current.activeProjects.status === "ok" ? current.activeProjects.value : null,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={TEAM_OVERSIKT_COPY.openChallenges} value={openChallenges === null ? { status: "unavailable" } : { status: "ok", value: openChallenges }} />
        <KpiCard label={TEAM_OVERSIKT_COPY.activeProjects} value={current.activeProjects} href={tabHref(teamId, "roadmap")} linkLabel={TEAM_OVERSIKT_COPY.links.roadmap} />
        <KpiCard label={TEAM_OVERSIKT_COPY.systemsAttention} value={current.systemsAttention} href={tabHref(teamId, "systems")} linkLabel={TEAM_OVERSIKT_COPY.links.systems} />
        <KpiCard label={TEAM_OVERSIKT_COPY.priorityPlans} value={current.priorityPlans} href={tabHref(teamId, "competence-plan")} linkLabel={TEAM_OVERSIKT_COPY.links["competence-plan"]} />
      </div>

      <Card as="section" variant="bordered" padding="md" aria-labelledby="team-oversikt-next-steps" className="flex flex-col gap-3">
        <h2 id="team-oversikt-next-steps" className="text-sm font-semibold text-text-primary">
          {TEAM_OVERSIKT_COPY.nextStepsHeading}
        </h2>
        {nextSteps.length === 0 ? (
          <p className="text-sm text-text-secondary">{TEAM_OVERSIKT_COPY.noNextSteps}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {nextSteps.map((step) => (
              <li key={step.kind} className="py-2">
                <Link
                  href={tabHref(teamId, step.kind)}
                  className="flex items-center justify-between gap-3 rounded-control text-sm font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span>{TEAM_OVERSIKT_COPY.nextStepLabels[step.kind](step.count)}</span>
                  <span className="text-text-secondary">
                    {TEAM_OVERSIKT_COPY.goTo} {TEAM_OVERSIKT_COPY.links[step.kind]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Tab routes under `/teams/[teamId]`; the segment names match the existing route folders. */
function tabHref(teamId: string, kind: OversiktNextStepKind): string {
  return `/teams/${encodeURIComponent(teamId)}/${kind}`;
}

function KpiCard({
  label,
  value,
  href,
  linkLabel,
}: {
  label: string;
  value: ReadState;
  href?: string;
  linkLabel?: string;
}) {
  const body: ReactNode =
    value.status === "ok" ? (
      <p className="text-metric font-semibold tabular-nums text-text-primary">{value.value}</p>
    ) : value.status === "loading" ? (
      <p className="text-sm text-text-secondary" aria-live="polite">
        {TEAM_OVERSIKT_COPY.loading}
      </p>
    ) : value.status === "forbidden" ? (
      <p className="text-sm text-text-secondary">{TEAM_OVERSIKT_COPY.forbiddenForMembers}</p>
    ) : (
      <p className="text-sm font-medium text-text-secondary">{TEAM_OVERSIKT_COPY.unavailable}</p>
    );

  return (
    <Card as="section" variant="bordered" padding="md" aria-label={label} className="flex flex-col gap-2">
      <h2 className="text-help text-text-secondary">{label}</h2>
      {body}
      {href && linkLabel && (
        <Link href={href} className="text-sm font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {TEAM_OVERSIKT_COPY.goTo} {linkLabel}
        </Link>
      )}
    </Card>
  );
}

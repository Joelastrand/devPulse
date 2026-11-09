"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Card } from "../../../components/ui/Card";
import { fetchCompetencePlans } from "../../team-competence-plan/client/competence-plan-gateway";
import { fetchTeamProjects } from "../../team-projects/client/team-projects-gateway";
import { fetchTeamSystems } from "../../team-systems/client/team-systems-gateway";
import { TeamOversiktProjects, type ProjectsRead } from "./TeamOversiktProjects";
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
  /** The same projects read as `activeProjects`, kept for the compact project list (no second request). */
  projects: ProjectsRead;
  systemsAttention: ReadState;
  priorityPlans: ReadState;
}

const LOADING: DerivedReads = {
  activeProjects: { status: "loading" },
  projects: { status: "loading" },
  systemsAttention: { status: "loading" },
  priorityPlans: { status: "loading" },
};

export interface TeamOversiktSummaryProps {
  teamId: string;
  token: string;
  /** Open challenge count from the challenges read already loaded by the team page; `null` when that read failed. */
  openChallenges: number | null;
  /** The compact open-challenges card, rendered below the projects and next-steps row. */
  challenges?: ReactNode;
}

/**
 * Four compact KPI cards and up to three `Neste steg` items (TASK-008, SPEC BR-1–BR-4). Each card reads one authorized
 * detail gateway, and each card has its own loading, forbidden and unavailable state, so a failed read never shows a `0`.
 */
export function TeamOversiktSummary({ teamId, token, openChallenges, challenges }: TeamOversiktSummaryProps) {
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
            projects:
              projects.status === "ok"
                ? { status: "ok", projects: projects.projects }
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
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          tone="neutral"
          icon="target"
          label={TEAM_OVERSIKT_COPY.openChallenges}
          value={openChallenges === null ? { status: "unavailable" } : { status: "ok", value: openChallenges }}
        />
        <KpiCard
          tone="amber"
          icon="calendar"
          label={TEAM_OVERSIKT_COPY.activeProjects}
          value={current.activeProjects}
          href={tabHref(teamId, "roadmap")}
          linkLabel={TEAM_OVERSIKT_COPY.links.roadmap}
        />
        <KpiCard
          tone="warning"
          icon="layers"
          label={TEAM_OVERSIKT_COPY.systemsAttention}
          value={current.systemsAttention}
          href={tabHref(teamId, "systems")}
          linkLabel={TEAM_OVERSIKT_COPY.links.systems}
        />
        <KpiCard
          tone="danger"
          icon="people"
          label={TEAM_OVERSIKT_COPY.priorityPlans}
          value={current.priorityPlans}
          href={tabHref(teamId, "competence-plan")}
          linkLabel={TEAM_OVERSIKT_COPY.links["competence-plan"]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <TeamOversiktProjects teamId={teamId} read={current.projects} />
        <Card as="section" variant="bordered" padding="md" aria-labelledby="team-oversikt-next-steps" className="flex min-w-0 flex-col gap-3">
          <h2 id="team-oversikt-next-steps" className="text-section-title font-semibold text-text-primary">
            {TEAM_OVERSIKT_COPY.nextStepsHeading}
          </h2>
          {nextSteps.length === 0 ? (
            <p className="text-sm text-text-secondary">{TEAM_OVERSIKT_COPY.noNextSteps}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {nextSteps.map((step) => (
                <li key={step.kind}>
                  <Link
                    href={tabHref(teamId, step.kind)}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-control py-3 text-sm font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-text-secondary" />
                      <span className="min-w-0 break-words">{TEAM_OVERSIKT_COPY.nextStepLabels[step.kind](step.count)}</span>
                    </span>
                    <span className="shrink-0 text-text-secondary">
                      {TEAM_OVERSIKT_COPY.goTo} {TEAM_OVERSIKT_COPY.links[step.kind]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {challenges ?? null}
    </div>
  );
}

/** Tab routes under `/teams/[teamId]`; the segment names match the existing route folders. */
function tabHref(teamId: string, kind: OversiktNextStepKind): string {
  return `/teams/${encodeURIComponent(teamId)}/${kind}`;
}

type KpiTone = "neutral" | "amber" | "warning" | "danger";
type KpiIcon = "target" | "calendar" | "layers" | "people";

/** Design tokens only (no raw palette), so light and dark themes follow app/globals.css. */
const TONE_CLASSES: Record<KpiTone, string> = {
  neutral: "bg-surface-subtle text-text-secondary",
  amber: "bg-primary-subtle text-primary-text",
  warning: "bg-warning-subtle text-warning-text",
  danger: "bg-danger-subtle text-danger-text",
};

/** Decorative line icons (aria-hidden); the card label carries the meaning. */
function KpiIconGlyph({ icon }: { icon: KpiIcon }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (icon) {
    case "target":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      );
    case "people":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="4" />
          <path d="M2 21v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.7" />
        </svg>
      );
  }
}

function KpiCard({
  label,
  value,
  href,
  linkLabel,
  tone,
  icon,
}: {
  label: string;
  value: ReadState;
  href?: string;
  linkLabel?: string;
  tone: KpiTone;
  icon: KpiIcon;
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
    <Card as="section" variant="bordered" padding="md" aria-label={label} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE_CLASSES[tone]}`}>
          <KpiIconGlyph icon={icon} />
        </span>
        <h2 className="min-w-0 break-words pt-1 text-sm text-text-secondary">{label}</h2>
      </div>
      {body}
      {href && linkLabel && (
        <Link
          href={href}
          className="w-fit text-sm font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {TEAM_OVERSIKT_COPY.goTo} {linkLabel}
        </Link>
      )}
    </Card>
  );
}

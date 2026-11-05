"use client";

import Link from "next/link";
import { ArrowRight, Layers, MessageSquare, Target, UserRound, Users, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import { Icon } from "../../../components/ui/Icon";
import { LoadingState } from "../../../components/ui/LoadingState";
import { ActionListItem, SummaryPanel } from "../../../components/ui/dashboard/DashboardPrimitives";
import { Section } from "../../../components/ui/Section";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { TeamsOverview } from "../../teams/components/TeamsOverview";
import { teamsCopy } from "../../teams/copy";
import type { GoalDto } from "../../personal-goals/domain/goal";
import type { OwnerSummaryWire } from "../../development-conversations/client/conversations-gateway";
import type { RoleTargetView } from "../../role-profiles/client/role-target-gateway";
import type { SurveyResultSummary } from "../../results/client/team-results-gateway";
import { resultsCopy } from "../../results/copy";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
import { TrendChart } from "../../results/components/TrendChart";
import type { TeamOverviewEntry } from "../../teams/client/teams-overview-gateway";
import { authenticatedHomeCopy } from "../copy";

const copy = authenticatedHomeCopy;

/**
 * One section's read state. Each home panel owns its own state so a failed
 * read never hides another panel (SPEC BR-32).
 */
export type Read<T> = { phase: "loading" } | { phase: "ok"; value: T } | { phase: "error" };

const LOADING_TEXT = "Laster…";

function ReadErrorText() {
  return <p className="text-help text-text-muted">{copy.readError}</p>;
}

function formatDate(value: string | null): string | null {
  if (value === null) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "long",
    timeZone: isDateOnly ? "UTC" : "Europe/Oslo",
  }).format(date);
}

/** Target dates sort ascending; undated goals sort last. */
function byTargetDate(a: GoalDto, b: GoalDto): number {
  if (a.targetDate === b.targetDate) return 0;
  if (a.targetDate === null) return 1;
  if (b.targetDate === null) return -1;
  return a.targetDate.localeCompare(b.targetDate);
}

function CountTile({ label, read, count }: { label: string; read: Read<unknown>; count: number | null }) {
  return (
    <Card as="section" variant="bordered" padding="sm" aria-label={label} className="flex flex-col gap-2">
      <p className="text-label font-medium text-text-secondary">{label}</p>
      {read.phase === "loading" ? <p className="text-help text-text-muted">{LOADING_TEXT}</p> : null}
      {read.phase === "error" ? <ReadErrorText /> : null}
      {read.phase === "ok" && count !== null ? (
        <p className="text-metric font-semibold tabular-nums text-text-primary">{count}</p>
      ) : null}
    </Card>
  );
}

/** Team entry tile: the first team the viewer belongs to, linked to its overview. */
export function TeamEntryTile({ read }: { read: Read<TeamOverviewEntry[]> }) {
  if (read.phase === "loading") {
    return <CountTile label={copy.tiles.team.label} read={read} count={null} />;
  }
  if (read.phase === "error") {
    return <CountTile label={copy.tiles.team.label} read={read} count={null} />;
  }
  const team = read.value.find((entry) => entry.relationship === "admin" || entry.relationship === "member");
  if (!team) {
    return (
      <Card as="section" variant="bordered" padding="sm" aria-label={copy.tiles.team.label} className="flex flex-col gap-2">
        <p className="text-help text-text-secondary">{copy.tiles.team.emptyText}</p>
        <Link href="/teams" className="inline-flex items-center gap-2 text-label font-medium text-primary">
          {copy.tiles.team.emptyAction}
          <Icon icon={ArrowRight} size="inline" />
        </Link>
      </Card>
    );
  }
  return (
    <Card as="section" variant="bordered" padding="sm" aria-label={copy.tiles.team.label} className="flex flex-col gap-2">
      <p className="text-label font-medium text-text-secondary">{copy.teamPanelTitle}</p>
      <p className="text-card-title font-semibold text-text-primary">{team.name}</p>
      <Link href={`/teams/${encodeURIComponent(team.teamId)}`} className="inline-flex items-center gap-2 text-label font-medium text-primary">
        {copy.teamPanelAction}
        <Icon icon={ArrowRight} size="inline" />
      </Link>
    </Card>
  );
}

const PULSE_DIMENSIONS = [
  { key: "flow", label: resultsCopy.trendTable.columns.flow },
  { key: "stress", label: resultsCopy.trendTable.columns.stress },
  { key: "fun", label: resultsCopy.trendTable.columns.fun },
] as const;

/** The most recent survey result by date, published or not. */
function latestSurvey(results: readonly SurveyResultSummary[]): SurveyResultSummary | null {
  let latest: SurveyResultSummary | null = null;
  for (const result of results) {
    if (latest === null || Date.parse(result.date) > Date.parse(latest.date)) latest = result;
  }
  return latest;
}

/**
 * Team pulse card: the per-dimension means of the team's latest survey result,
 * from the same team results read the team development chart uses. The result
 * has no single overall average, so none is computed. A suppressed result shows
 * the insufficient-responses label, never a value.
 */
export function TeamPulseTile({
  teams,
  teamId,
  results,
}: {
  teams: Read<TeamOverviewEntry[]>;
  teamId: string | null;
  results: Read<SurveyResultSummary[]>;
}) {
  return (
    <Card as="section" variant="bordered" padding="sm" aria-label={copy.pulse.label} className="flex flex-col gap-2">
      <p className="text-label font-medium text-text-secondary">{copy.pulse.label}</p>
      <PulseContent teams={teams} teamId={teamId} results={results} />
    </Card>
  );
}

function PulseContent({
  teams,
  teamId,
  results,
}: {
  teams: Read<TeamOverviewEntry[]>;
  teamId: string | null;
  results: Read<SurveyResultSummary[]>;
}) {
  if (teams.phase === "loading" || (teamId !== null && results.phase === "loading")) {
    return <p className="text-help text-text-muted">{LOADING_TEXT}</p>;
  }
  if (teams.phase === "error" || results.phase === "error") return <ReadErrorText />;
  if (teamId === null) return <p className="text-help text-text-secondary">{copy.tiles.team.emptyText}</p>;
  const latest = results.phase === "ok" ? latestSurvey(results.value) : null;
  if (results.phase !== "ok" || latest === null) {
    return <p className="text-help text-text-secondary">{copy.development.empty}</p>;
  }
  const dateLine = `${copy.pulse.latest} · ${formatSurveyDate(new Date(latest.date))}`;
  if (latest.status !== "published") {
    return (
      <>
        <p className="text-help text-text-muted">{dateLine}</p>
        <p className="text-help text-text-secondary">{resultsCopy.summaryStrip.insufficient}</p>
      </>
    );
  }
  return (
    <>
      <p className="text-help text-text-muted">{dateLine}</p>
      <dl className="flex flex-col gap-1">
        {PULSE_DIMENSIONS.map(({ key, label }) => (
          <div key={key} className="flex items-baseline justify-between gap-3">
            <dt className="text-help text-text-secondary">{label}</dt>
            <dd className="text-card-title font-semibold tabular-nums text-text-primary">{latest.mean[key].toFixed(1)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function GoalsPanel({ goals }: { goals: Read<GoalDto[]> }) {
  return (
    <SummaryPanel
      title={copy.goals.title}
      icon={Target}
      action={
        <Link href="/me/goals" className="inline-flex items-center gap-1 text-label font-medium text-primary">
          {copy.goals.all}
          <Icon icon={ArrowRight} size="inline" />
        </Link>
      }
    >
      {goals.phase === "loading" ? <p className="text-help text-text-muted">{LOADING_TEXT}</p> : null}
      {goals.phase === "error" ? <ReadErrorText /> : null}
      {goals.phase === "ok" ? (
        <GoalRows goals={goals.value} />
      ) : null}
    </SummaryPanel>
  );
}

function GoalRows({ goals }: { goals: readonly GoalDto[] }) {
  const active = goals.filter((goal) => goal.status === "active").sort(byTargetDate).slice(0, 3);
  if (active.length === 0) {
    return <p className="text-help text-text-secondary">{copy.goals.empty}</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {active.map((goal) => (
        <li key={goal.id} className="flex items-center justify-between gap-3 py-3">
          <span className="min-w-0">
            <span className="block text-label font-medium text-text-primary">{goal.title}</span>
            {formatDate(goal.targetDate) ? (
              <span className="block text-help text-text-secondary">{formatDate(goal.targetDate)}</span>
            ) : null}
          </span>
          <StatusBadge tone="success">{copy.goals.statusActive}</StatusBadge>
        </li>
      ))}
    </ul>
  );
}

export function NextConversationPanel({ conversations }: { conversations: Read<OwnerSummaryWire[]> }) {
  const next = conversations.phase === "ok" ? pickNextConversation(conversations.value) : null;
  const conversationId = next?.conversationId ?? "";
  return (
    <SummaryPanel title={copy.conversation.title} icon={MessageSquare}>
      {conversations.phase === "loading" ? <p className="text-help text-text-muted">{LOADING_TEXT}</p> : null}
      {conversations.phase === "error" ? <ReadErrorText /> : null}
      {conversations.phase === "ok" && next === null ? (
        <p className="text-help text-text-secondary">{copy.conversation.empty}</p>
      ) : null}
      {next !== null ? (
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <p className="text-label font-medium text-text-primary">{next.title}</p>
            <p className="text-help text-text-secondary">
              {formatDate(next.plannedFor) ?? copy.conversation.noDate}
              {next.participant.displayName ? ` · ${copy.conversation.withPrefix} ${next.participant.displayName}` : ""}
            </p>
          </div>
          <Link
            href={`/me/conversations/${conversationId}`}
            className="inline-flex w-fit items-center gap-2 rounded-control bg-primary-subtle px-4 py-2 text-label font-medium text-primary"
          >
            {copy.conversation.open}
            <Icon icon={ArrowRight} size="inline" />
          </Link>
        </div>
      ) : null}
    </SummaryPanel>
  );
}

/** The earliest open conversation with a planned date; undated open conversations come after. */
function pickNextConversation(items: readonly OwnerSummaryWire[]): OwnerSummaryWire | null {
  const open = items.filter((item) => item.status === "open");
  const sorted = [...open].sort((a, b) => {
    if (a.plannedFor === b.plannedFor) return 0;
    if (a.plannedFor === null) return 1;
    if (b.plannedFor === null) return -1;
    return a.plannedFor.localeCompare(b.plannedFor);
  });
  return sorted[0] ?? null;
}

export function RolePanel({ role }: { role: Read<RoleTargetView> }) {
  return (
    <SummaryPanel title={copy.role.title} icon={Layers}>
      {role.phase === "loading" ? <p className="text-help text-text-muted">{LOADING_TEXT}</p> : null}
      {role.phase === "error" ? <ReadErrorText /> : null}
      {role.phase === "ok" && role.value.status === "unavailable" ? (
        <p className="text-help text-text-secondary">{copy.role.unavailable}</p>
      ) : null}
      {role.phase === "ok" && role.value.status === "none" ? (
        <div className="flex flex-col gap-3">
          <p className="text-label font-medium text-text-primary">{copy.role.none}</p>
          <p className="text-help text-text-secondary">{copy.role.noneDescription}</p>
          <Link
            href="/me/skills"
            className="inline-flex w-fit items-center gap-2 rounded-control bg-primary-subtle px-4 py-2 text-label font-medium text-primary"
          >
            {copy.role.action}
            <Icon icon={ArrowRight} size="inline" />
          </Link>
        </div>
      ) : null}
      {role.phase === "ok" && role.value.status === "selected" ? (
        <div className="flex flex-col gap-2">
          <p className="text-help text-text-secondary">{copy.role.selectedLabel}</p>
          <p className="text-card-title font-semibold text-text-primary">{role.value.target.name}</p>
          {role.value.target.archived ? <StatusBadge tone="warning">{copy.role.archived}</StatusBadge> : null}
          <Link href="/me/skills" className="inline-flex w-fit items-center gap-2 text-label font-medium text-primary">
            {copy.role.action}
            <Icon icon={ArrowRight} size="inline" />
          </Link>
        </div>
      ) : null}
    </SummaryPanel>
  );
}

/**
 * Team development chart for the viewer's first team. It uses the team results
 * read that `AuthenticatedHome` already makes (the same read the team overview
 * uses) and renders the existing `TrendChart`, which applies the suppression
 * rules and never draws a zero for a suppressed survey.
 */
export function TeamDevelopmentPanel({
  teams,
  teamId,
  results,
}: {
  teams: Read<TeamOverviewEntry[]>;
  teamId: string | null;
  results: Read<SurveyResultSummary[]>;
}) {
  // A teams read that is still loading or has failed is never an empty team state (SPEC BR-32).
  if (teams.phase === "loading") {
    return <p className="text-help text-text-muted">{LOADING_TEXT}</p>;
  }
  if (teams.phase === "error") {
    return <ReadErrorText />;
  }
  if (teamId === null) {
    return <DevelopmentEmpty />;
  }
  if (results.phase === "loading") {
    return <p className="text-help text-text-muted">{LOADING_TEXT}</p>;
  }
  if (results.phase === "error") {
    return <ReadErrorText />;
  }
  if (results.value.length === 0) {
    return <DevelopmentEmpty />;
  }
  return <TrendChart results={results.value} />;
}

/** The first team the viewer belongs to (admin or member). Requests and rejections are not used. */
export function firstMemberTeamId(teams: readonly TeamOverviewEntry[]): string | null {
  return teams.find((entry) => entry.relationship === "admin" || entry.relationship === "member")?.teamId ?? null;
}

function DevelopmentEmpty() {
  return (
    <Card as="section" variant="bordered" padding="md" aria-label={copy.development.title}>
      <p className="text-help text-text-secondary">{copy.development.empty}</p>
    </Card>
  );
}

const SHORTCUTS: ReadonlyArray<{ label: string; description: string; href: string; icon: LucideIcon }> = [
  { ...copy.links.teams, icon: Users },
  { ...copy.links.skills, icon: Layers },
  { ...copy.links.goals, icon: Target },
  { ...copy.links.conversations, icon: MessageSquare },
];

/** Quick links to existing routes, restored from the baseline home. */
export function QuickLinks() {
  return (
    <nav aria-label={copy.quickLinksLabel}>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SHORTCUTS.map((link) => (
          <Card key={link.href} as="li" variant="bordered" padding="md" className="transition-shadow hover:shadow-elevated">
            <Link href={link.href} className="flex h-full flex-col gap-4 rounded-control">
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-control bg-primary-subtle text-primary">
                  <Icon icon={link.icon} size="feature" />
                </span>
                <Icon icon={ArrowRight} size="inline" className="text-text-muted" />
              </div>
              <span className="flex flex-col gap-1">
                <span className="font-semibold text-text-primary">{link.label}</span>
                <span className="text-sm text-text-secondary">{link.description}</span>
              </span>
            </Link>
          </Card>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The existing team list, restored from the baseline home. It renders the teams
 * list the home already read (no second read); request-access handling stays in `TeamsOverview`.
 */
export function TeamsSection({
  teams,
  onTeamsChanged,
}: {
  teams: Read<TeamOverviewEntry[]>;
  onTeamsChanged?: () => void;
}) {
  return (
    <Section title={copy.teamsSectionTitle} description={copy.teamsSectionDescription}>
      {teams.phase === "loading" ? <LoadingState label={teamsCopy.overview.loading} /> : null}
      {teams.phase === "error" ? <Alert variant="error">{teamsCopy.overview.error}</Alert> : null}
      {teams.phase === "ok" ? (
        <TeamsOverview initialTeams={teams.value} onTeamsChanged={onTeamsChanged} />
      ) : null}
    </Section>
  );
}

const NEXT_STEPS: ReadonlyArray<{ label: string; description: string; href: string; icon: LucideIcon }> = [
  { ...copy.nextSteps.teamNeeds, icon: Users },
  { ...copy.nextSteps.conversation, icon: MessageSquare },
  { ...copy.nextSteps.roles, icon: UserRound },
];

export function NextStepsPanel() {
  return (
    <SummaryPanel title={copy.nextStepsTitle} icon={Zap}>
      <ul className="flex flex-col gap-2">
        {NEXT_STEPS.map((step) => (
          <ActionListItem key={step.href + step.label} href={step.href} title={step.label} description={step.description} icon={step.icon} />
        ))}
      </ul>
    </SummaryPanel>
  );
}

"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, ChartColumn, ListChecks, MessageSquare, Target, TrendingUp, Users, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "../../../components/ui/Badge";
import { Icon } from "../../../components/ui/Icon";
import { cx } from "../../../components/ui/class-names";
import { Skeleton } from "../../../components/ui/Skeleton";
import { StatusBadge, type StatusTone } from "../../../components/ui/StatusBadge";
import type { GoalDto } from "../../personal-goals/domain/goal";
import type { OwnerSummaryWire } from "../../development-conversations/client/conversations-gateway";
import type { SurveyResultSummary } from "../../results/client/team-results-gateway";
import { formatSurveyDate } from "../../results/domain/format-survey-date";
import type { TeamOverviewEntry } from "../../teams/client/teams-overview-gateway";
import { teamsCopy } from "../../teams/copy";
import type { TaskDto } from "../../personal-tasks/domain/task";
import { authenticatedHomeCopy } from "../copy";
import { buildAttentionItems, countOpenTasks, type AttentionItem, type TaskAttentionState } from "../domain/attention-items";
import { TeamUpdateWave } from "./HomeBackdrop";

const copy = authenticatedHomeCopy;

/** One section's read state. Each home section owns its own state so a failed read never hides another section. */
export type Read<T> = { phase: "loading" } | { phase: "ok"; value: T } | { phase: "error" };

/** Teams shown before the "Se alle team" link appears. Every member team is listed; the link is a shortcut only. */
const TEAM_LIST_LINK_THRESHOLD = 3;

function ReadErrorText() {
  return <p className="text-help text-text-muted">{copy.readError}</p>;
}

function LoadingText() {
  return <span className="sr-only">{copy.loading}</span>;
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

/** Today's calendar date in Norway, as YYYY-MM-DD. Due dates are compared as calendar dates. */
export function todayIsoInOslo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The first team the viewer belongs to (admin or member). Requests and rejections are not used. */
export function firstMemberTeamId(teams: readonly TeamOverviewEntry[]): string | null {
  return teams.find((entry) => entry.canOpen)?.teamId ?? null;
}

/* ---------- Shared section chrome ---------- */

/** Icon, then a real heading. Used by every Home section so the headings share one treatment. */
function SectionHeading({ id, title, icon }: { id: string; title: string; icon: LucideIcon }) {
  return (
    <header className="flex items-center gap-3">
      <Icon icon={icon} size="action" className="text-primary" />
      <h2 id={id} className="text-panel-title font-semibold text-text-primary">
        {title}
      </h2>
    </header>
  );
}

/** Square icon tile in the soft green accent. Decorative: the adjacent text names the item. */
function IconTile({ icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-control bg-primary-subtle text-primary", className)}>
      <Icon icon={icon} size="inline" />
    </span>
  );
}

/* ---------- Dette er viktig nå ---------- */

const TASK_STATE_LABEL: Record<TaskAttentionState, string> = {
  overdue: copy.attention.taskOverdue,
  due_soon: copy.attention.taskDueSoon,
  high_priority: copy.attention.taskHighPriority,
};

const TASK_STATE_TONE: Record<TaskAttentionState, StatusTone> = {
  overdue: "danger",
  due_soon: "warning",
  high_priority: "info",
};

/**
 * A conversation has one action, so the row carries one link (no title link, so no nested or duplicate
 * links). The action is a bordered pill on the tinted panel, not a filled button.
 */
function ConversationAttentionRow({ item }: { item: Extract<AttentionItem, { kind: "conversation" }> }) {
  const dateText = formatDate(item.plannedFor) ?? copy.attention.conversationNoDate;
  const withText = item.participantName ? ` · ${copy.attention.conversationWithPrefix} ${item.participantName}` : "";
  return (
    <li className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <IconTile icon={MessageSquare} className="size-12 bg-surface" />
        <div className="min-w-0">
          <p className="break-words text-label font-semibold text-text-primary md:text-body">{item.title}</p>
          <p className="break-words text-help text-text-secondary">
            {copy.attention.conversationTitle} · {dateText}
            {withText}
          </p>
        </div>
      </div>
      <Link
        href={`/me/conversations/${item.conversationId}`}
        className="inline-flex w-fit shrink-0 items-center gap-2 rounded-control border border-primary/30 bg-surface px-4 py-2 text-label font-medium text-primary transition-colors duration-micro ease-standard hover:bg-surface-subtle"
      >
        {copy.attention.conversationAction}
        <Icon icon={ArrowRight} size="inline" />
      </Link>
    </li>
  );
}

/** A task row links once, through its title, to the task board. Nothing else in the row is interactive. */
function TaskAttentionRow({ item }: { item: Extract<AttentionItem, { kind: "task" }> }) {
  const dueText = item.dueDate ? formatDate(item.dueDate) : null;
  return (
    <li className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
      <IconTile icon={ListChecks} className="size-12 bg-surface" />
      <div className="min-w-0 flex-1">
        <Link href="/tasks" className="break-words text-label font-semibold text-text-primary underline-offset-4 hover:underline md:text-body">
          {item.title}
        </Link>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-help text-text-secondary">
          <StatusBadge tone={TASK_STATE_TONE[item.state]}>{TASK_STATE_LABEL[item.state]}</StatusBadge>
          <span>{dueText ?? copy.attention.taskNoDate}</span>
        </p>
      </div>
    </li>
  );
}

function AttentionRowsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingText />
      <Skeleton aria-hidden="true" className="h-14 w-full" />
    </div>
  );
}

/**
 * The priority surface: a green-tinted panel. Items come from the conversation and task reads the home already
 * holds. A failed source is named as an error and never counted as "nothing to do": the empty message appears
 * only when both reads succeeded.
 */
export function AttentionPanel({
  conversations,
  tasks,
  todayIso,
}: {
  conversations: Read<OwnerSummaryWire[]>;
  tasks: Read<TaskDto[]>;
  todayIso: string;
}) {
  const loading = conversations.phase === "loading" || tasks.phase === "loading";
  const failed = conversations.phase === "error" || tasks.phase === "error";
  const items = buildAttentionItems({
    conversations: conversations.phase === "ok" ? conversations.value : [],
    tasks: tasks.phase === "ok" ? tasks.value : [],
    todayIso,
  });

  return (
    <section aria-labelledby="home-attention-title" className="flex flex-col gap-4 rounded-surface border border-primary/25 bg-primary-subtle p-5 shadow-card md:p-6">
      <SectionHeading id="home-attention-title" title={copy.attention.title} icon={Zap} />
      {loading ? <AttentionRowsLoading /> : null}
      {!loading && items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-primary/20">
          {items.map((item) =>
            item.kind === "conversation" ? (
              <ConversationAttentionRow key={`c-${item.conversationId}`} item={item} />
            ) : (
              <TaskAttentionRow key={`t-${item.taskId}`} item={item} />
            ),
          )}
        </ul>
      ) : null}
      {!loading && items.length === 0 && !failed ? <p className="text-help text-text-secondary">{copy.attention.empty}</p> : null}
      {!loading && failed ? <ReadErrorText /> : null}
    </section>
  );
}

/* ---------- Min utvikling ---------- */

interface DevelopmentTile {
  label: string;
  action: string;
  href: string;
  icon: LucideIcon;
  count: number | null;
  failed: boolean;
  loading: boolean;
  /** The first metric carries the leading accent, as in the reference. The others stay neutral. */
  accent: boolean;
}

function DevelopmentCountTile({ tile }: { tile: DevelopmentTile }) {
  return (
    <li
      className={cx(
        "flex flex-col gap-5 rounded-surface border border-border-subtle bg-surface p-5 shadow-card",
        tile.accent && "border-l-4 border-l-primary",
      )}
    >
      <div className="flex items-start gap-4">
        <IconTile icon={tile.icon} />
        <div className="min-w-0">
          <p className="text-label font-medium text-text-secondary">{tile.label}</p>
          {tile.loading ? (
            <>
              <LoadingText />
              <Skeleton aria-hidden="true" className="mt-2 h-9 w-12" />
            </>
          ) : null}
          {tile.failed ? <ReadErrorText /> : null}
          {!tile.loading && !tile.failed && tile.count !== null ? (
            <p className="mt-1 text-metric font-semibold tabular-nums text-text-primary">{tile.count}</p>
          ) : null}
        </div>
      </div>
      <Link href={tile.href} className="mt-auto inline-flex w-fit items-center gap-2 text-label font-medium text-primary hover:underline">
        {tile.action}
        <Icon icon={ArrowRight} size="inline" />
      </Link>
    </li>
  );
}

/**
 * Compact personal overview: three metric cards under a plain section heading, with no outer container. A failed
 * or loading read shows no number, so no zero is ever invented.
 */
export function DevelopmentPanel({
  goals,
  conversations,
  tasks,
}: {
  goals: Read<GoalDto[]>;
  conversations: Read<OwnerSummaryWire[]>;
  tasks: Read<TaskDto[]>;
}) {
  const tiles: DevelopmentTile[] = [
    {
      ...copy.development.goals,
      icon: Target,
      accent: true,
      loading: goals.phase === "loading",
      failed: goals.phase === "error",
      count: goals.phase === "ok" ? goals.value.filter((goal) => goal.status === "active").length : null,
    },
    {
      ...copy.development.conversations,
      icon: MessageSquare,
      accent: false,
      loading: conversations.phase === "loading",
      failed: conversations.phase === "error",
      count: conversations.phase === "ok" ? conversations.value.filter((item) => item.status === "open").length : null,
    },
    {
      ...copy.development.tasks,
      icon: ListChecks,
      accent: false,
      loading: tasks.phase === "loading",
      failed: tasks.phase === "error",
      count: tasks.phase === "ok" ? countOpenTasks(tasks.value) : null,
    },
  ];

  return (
    <section aria-labelledby="home-development-title" className="flex flex-col gap-4">
      <SectionHeading id="home-development-title" title={copy.development.title} icon={TrendingUp} />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {tiles.map((tile) => (
          <DevelopmentCountTile key={tile.href} tile={tile} />
        ))}
      </ul>
    </section>
  );
}

/* ---------- Mine team ---------- */

/**
 * Member teams as one compact list. Each row shows the name, the relationship the server already returned, and one
 * link. Teams without access are not listed as links; they are requested on the Team page.
 */
export function TeamsPanel({ teams }: { teams: Read<TeamOverviewEntry[]> }) {
  return (
    <section aria-labelledby="home-teams-title" className="flex flex-col gap-4 rounded-surface border border-border-subtle bg-surface p-5 shadow-card md:p-6">
      <SectionHeading id="home-teams-title" title={copy.teams.title} icon={Users} />
      {teams.phase === "loading" ? (
        <div className="flex flex-col gap-3">
          <LoadingText />
          <Skeleton aria-hidden="true" className="h-12 w-full" />
        </div>
      ) : null}
      {teams.phase === "error" ? <ReadErrorText /> : null}
      {teams.phase === "ok" ? <MemberTeamList teams={teams.value.filter((entry) => entry.canOpen)} /> : null}
    </section>
  );
}

function MemberTeamList({ teams }: { teams: readonly TeamOverviewEntry[] }) {
  if (teams.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-help text-text-secondary">{copy.teams.empty}</p>
        <Link href="/teams" className="inline-flex items-center gap-1 text-label font-medium text-primary hover:underline">
          {copy.teams.emptyAction}
          <Icon icon={ArrowRight} size="inline" />
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={copy.teams.listLabel} className="flex flex-col divide-y divide-border-subtle">
        {teams.map((team) => (
          <li key={team.teamId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <span className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="break-words text-label font-semibold text-text-primary">{team.name}</span>
              <Badge>{teamsCopy.relationshipLabels[team.relationship]}</Badge>
            </span>
            <Link
              href={`/teams/${encodeURIComponent(team.teamId)}`}
              className="inline-flex shrink-0 items-center gap-1 text-label font-medium text-primary hover:underline"
            >
              {copy.teams.openTeam}
              <Icon icon={ArrowRight} size="inline" />
            </Link>
          </li>
        ))}
      </ul>
      {teams.length > TEAM_LIST_LINK_THRESHOLD ? (
        <Link href="/teams" className="inline-flex w-fit items-center gap-1 text-label font-medium text-primary hover:underline">
          {copy.teams.allTeams}
          <Icon icon={ArrowRight} size="inline" />
        </Link>
      ) : null}
    </div>
  );
}

/* ---------- Siste nytt fra teamet ---------- */

/** The most recent published survey by date. Suppressed and unpublished results are never a candidate. */
function latestPublished(results: readonly SurveyResultSummary[]): SurveyResultSummary | null {
  let latest: SurveyResultSummary | null = null;
  for (const result of results) {
    if (result.status !== "published") continue;
    if (latest === null || Date.parse(result.date) > Date.parse(latest.date)) latest = result;
  }
  return latest;
}

/**
 * Compact team update for the first member team, with its name shown so the context is explicit. It shows only the
 * date of the latest published survey, never its values, and it links to the full results page. A suppressed survey
 * is described as too few answers, never as a score or zero. The lower-right wave and the bar icon are decorative.
 */
export function TeamUpdatePanel({
  teams,
  teamId,
  results,
}: {
  teams: Read<TeamOverviewEntry[]>;
  teamId: string | null;
  results: Read<SurveyResultSummary[]>;
}) {
  const teamName = teams.phase === "ok" ? (teams.value.find((entry) => entry.teamId === teamId)?.name ?? null) : null;
  return (
    <section
      aria-labelledby="home-team-update-title"
      className="relative isolate flex flex-col gap-4 overflow-hidden rounded-surface border border-border-subtle bg-surface p-5 pb-16 shadow-card md:p-6 md:pb-20"
    >
      <TeamUpdateWave />
      <SectionHeading id="home-team-update-title" title={copy.teamUpdate.title} icon={CalendarClock} />
      <TeamUpdateBody teams={teams} teamId={teamId} teamName={teamName} results={results} />
      <Icon icon={ChartColumn} size="feature" className="pointer-events-none absolute bottom-5 right-5 text-primary" />
    </section>
  );
}

function TeamUpdateBody({
  teams,
  teamId,
  teamName,
  results,
}: {
  teams: Read<TeamOverviewEntry[]>;
  teamId: string | null;
  teamName: string | null;
  results: Read<SurveyResultSummary[]>;
}) {
  if (teams.phase === "loading" || (teamId !== null && results.phase === "loading")) {
    return (
      <div className="flex flex-col gap-3">
        <LoadingText />
        <Skeleton aria-hidden="true" className="h-4 w-40" />
        <Skeleton aria-hidden="true" className="h-4 w-56" />
      </div>
    );
  }
  if (teams.phase === "error" || results.phase === "error") return <ReadErrorText />;
  if (teamId === null || teamName === null) {
    return <p className="text-help text-text-secondary">{copy.teamUpdate.noTeam}</p>;
  }
  if (results.phase !== "ok") return <ReadErrorText />;

  const latest = latestPublished(results.value);
  const resultsHref = `/teams/${encodeURIComponent(teamId)}/results`;
  let message: string;
  if (latest !== null) {
    message = `${copy.teamUpdate.latestPublished} · ${formatSurveyDate(new Date(latest.date))}`;
  } else if (results.value.length > 0) {
    message = copy.teamUpdate.insufficient;
  } else {
    message = copy.teamUpdate.noSurveys;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-help text-text-muted">
        {copy.teamUpdate.teamPrefix}: <span className="font-medium text-text-primary">{teamName}</span>
      </p>
      <p className="text-label text-text-primary">{message}</p>
      <Link href={resultsHref} className="inline-flex w-fit items-center gap-1 text-label font-medium text-primary hover:underline">
        {copy.teamUpdate.action}
        <Icon icon={ArrowRight} size="inline" />
      </Link>
    </div>
  );
}

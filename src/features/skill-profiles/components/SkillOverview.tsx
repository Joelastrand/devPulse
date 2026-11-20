"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { catchError } from "next/error";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { ChartColumn, Sprout, Target } from "lucide-react";
import { Alert } from "../../../components/ui/Alert";
import { Button, buttonClassName } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { SkillOverviewSkeleton } from "./SkillSkeletons";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchOwnSkills } from "../client/skill-profile-gateway";
import { OwnTeamCompetenceSummary } from "../../team-owned-skills/components/OwnTeamCompetenceSummary";
import { SELF_ASSESSED_LEVEL_COPY, skillCatalogCopy, skillProfileCopy, skillViewCopy } from "../copy";
import { SELF_ASSESSED_LEVELS, type SelfAssessedLevel } from "../domain/self-assessed-level";
import { buildOverviewModel, type OverviewAreaRow, type OverviewModel } from "../domain/overview-model";
import { buildPersonalRadarModel } from "../domain/personal-radar";
import type { SkillRowDto } from "../domain/skill-profile-view";
import type { PersonalRadar as PersonalRadarComponent } from "./PersonalRadar";
import { ChartLoadError, ChartPlaceholder } from "../../../components/ui/LazyChart";

/**
 * `PersonalRadar` is code-split out of the skills route's client bundle; `recharts` loads only when the radar is shown.
 * Declared at module scope for webpack chunk matching. The loading box keeps the radar's own size.
 */
const LazyPersonalRadar = dynamic<ComponentProps<typeof PersonalRadarComponent>>(
  () => import("./PersonalRadar").then((mod) => mod.PersonalRadar),
  {
    ssr: false,
    loading: () => <ChartPlaceholder className="mx-auto h-[300px] w-full max-w-[360px]" />,
  },
);

const PersonalRadarBoundary = catchError(ChartLoadError);

/** How many skill areas the overview lists. The full, editable list lives in the Kompetansekart view. */
const OVERVIEW_AREA_LIMIT = 7;

interface LoadedOverview {
  readonly skills: readonly SkillRowDto[];
  readonly truncated: boolean;
  readonly unreadable: boolean;
}

type ViewState = { phase: "loading" } | { phase: "signed_out" } | { phase: "error" } | ({ phase: "ready" } & LoadedOverview);

/** Route-backed link to one of the `/me/skills` views (`?vy=`). */
function viewHref(view: string): string {
  return `/me/skills?vy=${view}`;
}

/**
 * The Oversikt view of `/me/skills`. It reads only the person's own self-assessments and shows descriptive counts, next
 * steps and the competence profile of those assessments. It has no role, target, expected level or development gap, and it
 * never renders the editing form: editing lives in the Kompetansekart view.
 */
export function SkillOverview() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  /** null until the team summary has loaded; then whether any team still has unassessed competencies. */
  const [teamsIncomplete, setTeamsIncomplete] = useState<boolean | null>(null);

  useAuthGatedResource(
    (token, generation, isCurrentGeneration) => {
      if (!token) {
        setState({ phase: "signed_out" });
        return;
      }
      setState({ phase: "loading" });
      void fetchOwnSkills(token).then((skills) => {
        if (!isCurrentGeneration(generation)) return;
        if (skills.status === "unauthenticated") {
          setState({ phase: "signed_out" });
          return;
        }
        if (skills.status !== "ok") {
          setState({ phase: "error" });
          return;
        }
        setState({
          phase: "ready",
          skills: skills.dto.skills,
          truncated: skills.dto.truncated,
          unreadable: skills.dto.profile === "unreadable",
        });
      });
    },
    [reloadKey],
  );

  if (state.phase === "loading") return <SkillOverviewSkeleton label={skillProfileCopy.loading} />;

  if (state.phase === "signed_out") {
    return (
      <p className="text-text-secondary">
        <Link href="/sign-in" className="font-medium text-text-primary underline">
          {skillProfileCopy.signInLink}
        </Link>{" "}
        {skillProfileCopy.signInPrompt}
      </p>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">{skillProfileCopy.loadError}</Alert>
        <Button variant="secondary" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
          {skillProfileCopy.retryButton}
        </Button>
      </div>
    );
  }

  return <OverviewReady state={state} teamsIncomplete={teamsIncomplete} onTeamsReady={setTeamsIncomplete} />;
}

/**
 * Top: the personal skill summary. Middle: the team competency summary, kept separate because each team has its own catalog.
 * Bottom: one primary next step (which depends on both domains) beside the compact competence profile.
 */
function OverviewReady({
  state,
  teamsIncomplete,
  onTeamsReady,
}: {
  readonly state: LoadedOverview;
  readonly teamsIncomplete: boolean | null;
  readonly onTeamsReady: (anyTeamIncomplete: boolean) => void;
}) {
  // An unreadable profile is never interpreted: its stored levels are hidden, so every row is treated as unassessed here.
  const skills: readonly SkillRowDto[] = state.unreadable ? state.skills.map((row) => ({ ...row, level: null })) : state.skills;
  const model = buildOverviewModel(skills);
  const copy = skillCatalogCopy.personal;

  return (
    <div className="flex flex-col gap-6">
      {state.unreadable ? <Alert variant="error">{skillProfileCopy.unreadableNotice}</Alert> : null}
      {state.truncated ? <Alert variant="info">{skillProfileCopy.truncatedNotice}</Alert> : null}

      {skills.length === 0 ? (
        <p className="text-text-secondary">{skillProfileCopy.noSkillsDefined}</p>
      ) : (
        <section aria-labelledby="overview-personal-heading" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="overview-personal-heading" className="text-lg font-semibold text-text-primary">
              {copy.progressHeading}
            </h2>
            <p className="text-sm text-text-secondary">{copy.listProgress(model.summary.assessedCount, model.summary.totalCount)}</p>
          </div>
          <SummaryRow model={model} />
        </section>
      )}

      <OwnTeamCompetenceSummary onReady={onTeamsReady} />

      {skills.length > 0 ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <NextStepsPanel model={model} teamsIncomplete={teamsIncomplete} />
          <ProfilePanel model={model} />
        </div>
      ) : null}

      <p className="text-xs text-text-secondary">{skillProfileCopy.privacyNotice}</p>
    </div>
  );
}

function SummaryRow({ model }: { readonly model: OverviewModel }) {
  const copy = skillProfileCopy.overview;
  const { summary } = model;
  return (
    <ul className="grid gap-4 sm:grid-cols-3">
      <SummaryCard icon={Target} title={copy.summaryAdvancedTitle} value={String(summary.atLeastIndependent)} detail={copy.summaryAdvancedDetail} />
      <SummaryCard
        icon={ChartColumn}
        title={copy.summaryAssessedTitle}
        value={copy.summaryAssessedValue(summary.assessedCount, summary.totalCount)}
        detail={copy.summaryAssessedDetail}
      />
      <SummaryCard icon={Sprout} title={copy.summaryDevelopTitle} value={String(summary.developmentAreaCount)} detail={copy.summaryDevelopDetail} />
    </ul>
  );
}

function SummaryCard({
  icon: Icon,
  title,
  value,
  detail,
  children,
}: {
  readonly icon: typeof Target;
  readonly title: string;
  readonly value: string;
  readonly detail: string;
  readonly children?: ReactNode;
}) {
  const headingId = useId();
  return (
    <li className="contents">
      <Card as="section" padding="sm" aria-labelledby={headingId} className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-text-secondary" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="text-sm font-semibold text-text-primary">
            {title}
          </h2>
          <p className="text-2xl font-semibold text-text-primary">{value}</p>
          <p className="text-xs text-text-secondary">{detail}</p>
          {children}
        </div>
      </Card>
    </li>
  );
}

/**
 * One primary next step that follows the person's own assessment state, plus a short list of the other existing pages.
 * Only counts from the overview model are used: no goals, team needs or other data are fetched for this panel.
 *   - nothing assessed   -> start assessing
 *   - some unassessed    -> assess the remaining skills (nothing else is urged)
 *   - all assessed       -> review what has been assessed, without nudging towards assessment
 */
function NextStepsPanel({
  model,
  teamsIncomplete,
}: {
  readonly model: OverviewModel;
  /** null while the team summary is still loading; then no team action is suggested. */
  readonly teamsIncomplete: boolean | null;
}) {
  const headingId = useId();
  const copy = skillProfileCopy.overview;
  const teamCopy = skillCatalogCopy.team;
  const nothingAssessed = model.summary.assessedCount === 0;
  const someUnassessed = !nothingAssessed && model.unassessedCount > 0;
  const personalComplete = !nothingAssessed && !someUnassessed;
  const teamAction = personalComplete && teamsIncomplete === true;

  // Exactly one primary action, chosen from the person's real state: personal assessment first, then the team competencies.
  const primary = nothingAssessed
    ? { href: viewHref(skillViewCopy.tabs[1].view), label: copy.startAction }
    : someUnassessed
      ? { href: viewHref(skillViewCopy.tabs[1].view), label: copy.continueAction }
      : teamAction
        ? { href: viewHref(skillViewCopy.tabs[2].view), label: teamCopy.summaryAction }
        : { href: viewHref(skillViewCopy.tabs[1].view), label: copy.reviewAction };

  const hint = nothingAssessed
    ? copy.startHint
    : someUnassessed
      ? copy.unassessedHint(model.unassessedCount)
      : teamAction
        ? teamCopy.nextStepHint
        : copy.allAssessedHint;

  const secondary = [
    { href: "/me/goals", label: copy.goalsAction },
    { href: viewHref(skillViewCopy.tabs[3].view), label: copy.roleWorkspaceAction },
  ];

  return (
    <Card as="section" padding="sm" aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-base font-semibold text-text-primary">
        {copy.nextStepsHeading}
      </h2>
      <p className="text-sm text-text-primary">{hint}</p>
      <div>
        <Link href={primary.href} className={buttonClassName({ variant: "primary", size: "md" })}>
          {primary.label}
        </Link>
      </div>
      <ul className="flex flex-col gap-1 border-t border-border-subtle pt-3 text-sm">
        {secondary.map((item) => (
          <li key={item.href + item.label}>
            <Link href={item.href} className="inline-flex min-h-11 items-center text-text-secondary underline-offset-2 hover:text-text-primary hover:underline">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

type ProfileView = "list" | "radar";

/**
 * The competence profile of the person's own assessments. The list is the default, detailed view; the radar is an optional
 * view of the same own levels, switched on by the person. Neither view reads anything beyond the overview model.
 */
function ProfilePanel({ model }: { readonly model: OverviewModel }) {
  const headingId = useId();
  const copy = skillProfileCopy.overview;
  const [view, setView] = useState<ProfileView>("list");
  const shown = model.areas.slice(0, OVERVIEW_AREA_LIMIT);
  const hidden = model.areas.length - shown.length;
  const radar = buildPersonalRadarModel(model.areas);
  return (
    <Card as="section" padding="sm" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="text-base font-semibold text-text-primary">
          {copy.profileHeading}
        </h2>
        <Link href={viewHref(skillViewCopy.tabs[1].view)} className="text-sm font-medium text-text-primary underline">
          {copy.seeAll}
        </Link>
      </div>
      <p className="text-xs text-text-secondary">{copy.profileIntro}</p>
      <div role="group" aria-label={copy.viewSwitchLabel} className="flex gap-2">
        <Button variant={view === "list" ? "primary" : "secondary"} size="sm" aria-pressed={view === "list"} onClick={() => setView("list")}>
          {copy.viewList}
        </Button>
        <Button variant={view === "radar" ? "primary" : "secondary"} size="sm" aria-pressed={view === "radar"} onClick={() => setView("radar")}>
          {copy.viewRadar}
        </Button>
      </div>
      {view === "list" ? (
        <>
          <ul className="flex flex-col divide-y divide-border-subtle">
            {shown.map((area) => (
              <ProfileRow key={area.treeId} area={area} />
            ))}
          </ul>
          {hidden > 0 ? <p className="text-xs text-text-secondary">{copy.moreAreas(hidden)}</p> : null}
        </>
      ) : radar.status === "ready" ? (
        <PersonalRadarBoundary>
          <LazyPersonalRadar points={radar.points} unassessedCount={radar.unassessedCount} omittedByCap={radar.omittedByCap} />
        </PersonalRadarBoundary>
      ) : (
        <p className="text-sm text-text-secondary">{copy.radarTooFew(radar.assessedCount)}</p>
      )}
    </Card>
  );
}

function ProfileRow({ area }: { readonly area: OverviewAreaRow }) {
  const levelText =
    area.level !== null
      ? skillProfileCopy.levelSummary(area.level, SELF_ASSESSED_LEVEL_COPY[area.level].name)
      : skillProfileCopy.unassessed;
  return (
    <li className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-text-primary">{area.name}</p>
        <p className="text-xs text-text-secondary">{levelText}</p>
      </div>
      <LevelBar level={area.level} />
    </li>
  );
}

/** Four steps, filled up to the person's own level. The level is also in the text beside it, so meaning is not colour alone. */
function LevelBar({ level }: { readonly level: SelfAssessedLevel | null }) {
  return (
    <span aria-hidden="true" className="flex gap-0.5 sm:justify-self-end">
      {SELF_ASSESSED_LEVELS.map((step) => {
        const filled = level !== null && step <= level;
        return (
          <span
            key={step}
            className="h-3 w-5 rounded-sm"
            style={{ background: filled ? "var(--chart-1)" : "var(--border-subtle)" }}
          />
        );
      })}
    </span>
  );
}

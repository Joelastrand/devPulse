"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { ChartColumn, Layers, Sprout, Target, TriangleAlert } from "lucide-react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchRoleComparison, type ComparisonView } from "../../role-profiles/client/role-target-gateway";
import { fetchOwnSkills } from "../client/skill-profile-gateway";
import { SELF_ASSESSED_LEVEL_COPY, skillDashboardCopy, skillProfileCopy, skillViewCopy } from "../copy";
import { isSelfAssessedLevel, SELF_ASSESSED_LEVELS, type SelfAssessedLevel } from "../domain/self-assessed-level";
import { buildOverviewModel, type OverviewAreaRow, type OverviewModel } from "../domain/overview-model";
import { buildPersonalRadarModel } from "../domain/personal-radar";
import type { SkillRowDto } from "../domain/skill-profile-view";
import { PersonalRadar } from "./PersonalRadar";

/** How many skill areas the overview lists. The full, editable list lives in the Kompetansekart view. */
const OVERVIEW_AREA_LIMIT = 7;
const OVERVIEW_SUGGESTION_LIMIT = 3;

interface LoadedOverview {
  readonly skills: readonly SkillRowDto[];
  readonly truncated: boolean;
  readonly unreadable: boolean;
  readonly comparison: ComparisonView | null;
  readonly comparisonFailed: boolean;
}

type ViewState = { phase: "loading" } | { phase: "signed_out" } | { phase: "error" } | ({ phase: "ready" } & LoadedOverview);

/** Route-backed link to one of the `/me/skills` views (`?vy=`). */
function viewHref(view: string): string {
  return `/me/skills?vy=${view}`;
}

/**
 * The Oversikt view of `/me/skills` (C1 BR-29 as amended 2026-11-10; visual-redesign ref 07). Compact summary cards, the
 * personal radar, a short competence-area list, role development and a banner. It reads only the person's own
 * assessments and, when a target is selected, the owner-only comparison. It shows no team data, no mean or score, and never
 * renders the editing form: editing lives in the Kompetansekart view.
 */
export function SkillOverview() {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useAuthGatedResource(
    (token, generation, isCurrentGeneration) => {
      if (!token) {
        setState({ phase: "signed_out" });
        return;
      }
      setState({ phase: "loading" });
      void Promise.all([fetchOwnSkills(token), fetchRoleComparison(token)]).then(([skills, comparison]) => {
        if (!isCurrentGeneration(generation)) return;
        if (skills.status === "unauthenticated" || comparison.status === "unauthenticated") {
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
          comparison: comparison.status === "ok" ? comparison.view : null,
          comparisonFailed: comparison.status !== "ok",
        });
      });
    },
    [reloadKey],
  );

  if (state.phase === "loading") return <LoadingState label={skillProfileCopy.loading} />;

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

  return <OverviewReady state={state} />;
}

function OverviewReady({ state }: { readonly state: LoadedOverview }) {
  // An unreadable profile is never interpreted: its stored levels are hidden, so every row is treated as unassessed here.
  const skills: readonly SkillRowDto[] = state.unreadable ? state.skills.map((row) => ({ ...row, level: null })) : state.skills;
  const comparison = state.comparison?.state === "available" ? { targetName: state.comparison.target.name, rows: state.comparison.rows } : null;
  const model = buildOverviewModel(skills, comparison);
  const roleName = model.target?.name ?? null;

  return (
    <div className="flex flex-col gap-4">
      {state.unreadable ? <Alert variant="error">{skillProfileCopy.unreadableNotice}</Alert> : null}
      {state.truncated ? <Alert variant="info">{skillProfileCopy.truncatedNotice}</Alert> : null}
      {state.comparisonFailed ? <Alert variant="error">{skillProfileCopy.overview.comparisonError}</Alert> : null}

      {skills.length === 0 ? (
        <p className="text-text-secondary">{skillProfileCopy.noSkillsDefined}</p>
      ) : (
        <>
          <SummaryRow model={model} roleName={roleName} truncated={state.truncated} />
          {/* Stacked below lg (the content beside the sidebar is too narrow for two panels). Two columns from lg; the 30 / 40 / 30 dashboard from xl. */}
          <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,3fr)]">
            <RadarPanel areas={model.areas} roleName={roleName} />
            <AreasPanel model={model} />
            <div className="grid min-w-0 gap-4 lg:col-span-2 lg:grid-cols-2 xl:col-span-1 xl:grid-cols-1">
              <RolePanel model={model} />
              <SuggestionsPanel model={model} />
            </div>
          </div>
          <DevelopmentBanner model={model} />
        </>
      )}

      <p className="text-xs text-text-secondary">{skillProfileCopy.privacyNotice}</p>
    </div>
  );
}

function SummaryRow({ model, roleName, truncated }: { readonly model: OverviewModel; readonly roleName: string | null; readonly truncated: boolean }) {
  const { summary } = model;
  const shown = truncated ? skillDashboardCopy.shownDetail : null;
  return (
    <ul className="grid gap-4 sm:grid-cols-3">
      <SummaryCard icon={Target} title={skillDashboardCopy.developmentLabel} value={String(summary.atLeastIndependent)} detail={skillDashboardCopy.developmentDetail}>
        {roleName !== null ? <span className="text-xs text-text-secondary">{skillProfileCopy.overview.roleSelected(roleName)}</span> : <span className="text-xs text-text-secondary">{skillProfileCopy.overview.summaryTargetNone}</span>}
      </SummaryCard>
      <SummaryCard
        icon={ChartColumn}
        title={skillDashboardCopy.assessedLabel}
        value={`${summary.assessedCount} av ${summary.totalCount}`}
        detail={shown ?? "ferdigheter er vurdert"}
      />
      <SummaryCard icon={Sprout} title={skillDashboardCopy.areasLabel} value={String(summary.developmentAreaCount)} detail={skillDashboardCopy.areasDetail} />
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

function RadarPanel({ areas, roleName }: { readonly areas: readonly OverviewAreaRow[]; readonly roleName: string | null }) {
  const headingId = useId();
  const copy = skillProfileCopy.overview;
  const radar = buildPersonalRadarModel(areas, roleName !== null);
  return (
    <Card as="section" padding="sm" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h2 id={headingId} className="text-base font-semibold text-text-primary">
        {copy.radarHeading}
      </h2>
      {radar.status === "too_few_assessed" ? (
        <p className="text-sm text-text-secondary">{copy.radarTooFew}</p>
      ) : (
        <PersonalRadar points={radar.points} showTarget={radar.showTarget} roleName={roleName} omittedCount={radar.omittedCount} />
      )}
    </Card>
  );
}

function AreasPanel({ model }: { readonly model: OverviewModel }) {
  const headingId = useId();
  const copy = skillProfileCopy.overview;
  const shown = model.areas.slice(0, OVERVIEW_AREA_LIMIT);
  const hidden = model.areas.length - shown.length;
  return (
    <Card as="section" padding="sm" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="text-base font-semibold text-text-primary">
          {copy.areasHeading}
        </h2>
        <Link href={viewHref(skillViewCopy.tabs[1].view)} className="text-sm font-medium text-text-primary underline">
          {copy.seeAll}
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {shown.map((area) => (
          <AreaRow key={area.treeId} area={area} />
        ))}
      </ul>
      {hidden > 0 ? <p className="text-xs text-text-secondary">{copy.moreAreas(hidden)}</p> : null}
    </Card>
  );
}

function AreaRow({ area }: { readonly area: OverviewAreaRow }) {
  const copy = skillProfileCopy.overview;
  const levelName = area.level !== null ? SELF_ASSESSED_LEVEL_COPY[area.level].name : skillProfileCopy.unassessed;
  return (
    <li className="flex flex-col gap-1 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Layers aria-hidden="true" className="h-4 w-4 shrink-0 text-text-secondary" />
        <span className="min-w-0 break-words text-sm font-medium text-text-primary">{area.name}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-text-secondary">
        <LevelSegments level={area.level} />
        <span>{levelName}</span>
        <StatusText status={area.status} copy={copy} />
      </span>
    </li>
  );
}

/** Four segments as a visual aid; the level name next to it carries the meaning (C1 BR-27, BR-31). */
function LevelSegments({ level }: { readonly level: SelfAssessedLevel | null }) {
  return (
    <span aria-hidden="true" className="flex gap-0.5">
      {SELF_ASSESSED_LEVELS.map((segment) => (
        <span
          key={segment}
          className="h-2 w-4 rounded-sm"
          style={{ background: level !== null && segment <= level ? "var(--chart-1)" : "var(--border-strong)" }}
        />
      ))}
    </span>
  );
}

function StatusText({ status, copy }: { readonly status: OverviewAreaRow["status"]; readonly copy: typeof skillProfileCopy.overview }) {
  if (status === null) return null;
  if (status === "meets") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-text-primary">
        <span aria-hidden="true">✓</span>
        {copy.statusMeets}
      </span>
    );
  }
  if (status === "development_opportunity") {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-text-primary">
        <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
        {copy.statusDevelopment}
      </span>
    );
  }
  return <span className="text-text-secondary">{status === "area_unavailable" ? copy.statusUnavailable : copy.statusNotAssessed}</span>;
}

function RolePanel({ model }: { readonly model: OverviewModel }) {
  const headingId = useId();
  const copy = skillProfileCopy.overview;
  const target = model.target;
  return (
    <Card as="section" padding="sm" aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-base font-semibold text-text-primary">
        {copy.roleHeading}
      </h2>
      {target === null ? (
        <p className="text-sm text-text-secondary">{copy.roleNone}</p>
      ) : (
        <>
          <p className="text-sm font-medium text-text-primary">{copy.roleSelected(target.name)}</p>
          <p className="text-sm text-text-secondary">{copy.roleDetail(target.meetsCount, target.expectationCount)}</p>
        </>
      )}
      <Link href={viewHref(skillViewCopy.tabs[2].view)} className="text-sm font-medium text-text-primary underline">
        {copy.roleAction}
      </Link>
    </Card>
  );
}

function SuggestionsPanel({ model }: { readonly model: OverviewModel }) {
  const headingId = useId();
  const copy = skillProfileCopy.overview;
  const shown = model.suggestions.slice(0, OVERVIEW_SUGGESTION_LIMIT);
  const intro = model.target !== null ? copy.suggestionsTargetIntro : copy.suggestionsNoTargetIntro;
  return (
    <Card as="section" padding="sm" aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-base font-semibold text-text-primary">
        {copy.suggestionsHeading}
      </h2>
      <p className="text-xs text-text-secondary">{intro}</p>
      {shown.length === 0 ? (
        <p className="text-sm text-text-secondary">{copy.suggestionsNone}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((suggestion) => (
            <li key={suggestion.treeId}>
              <Link
                href={viewHref(skillViewCopy.tabs[2].view)}
                className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm text-text-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span className="min-w-0">
                  <span className="block break-words font-medium">{suggestion.name}</span>
                  {suggestion.expectedLevel !== null && isSelfAssessedLevel(suggestion.expectedLevel) ? (
                    <span className="block text-xs text-text-secondary">
                      {copy.suggestionExpected(SELF_ASSESSED_LEVEL_COPY[suggestion.expectedLevel].name)}
                    </span>
                  ) : null}
                </span>
                <span aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DevelopmentBanner({ model }: { readonly model: OverviewModel }) {
  const copy = skillProfileCopy.overview;
  const roleName = model.target?.name ?? null;
  let text: string;
  if (roleName !== null) {
    text = model.developmentTotal > 0 ? copy.bannerTarget(model.developmentTotal, roleName) : copy.bannerTargetNone(roleName);
  } else {
    text = model.developmentTotal > 0 ? copy.bannerNoTarget(model.developmentTotal) : copy.suggestionsNone;
  }
  return (
    <section aria-labelledby="skill-banner-heading" className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="skill-banner-heading" className="text-base font-semibold text-text-primary">
          {copy.bannerHeading}
        </h2>
        <p className="text-sm text-text-secondary">{text}</p>
      </div>
      {/* Links to the existing personal goals page; no goal logic here (D1 owns goals). */}
      <Link href="/me/goals" className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-subtle">
        {copy.bannerAction}
      </Link>
    </section>
  );
}

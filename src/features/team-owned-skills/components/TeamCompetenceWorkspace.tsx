"use client";

import { lazy, Suspense, useState } from "react";
import { catchError } from "next/error";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { Alert } from "../../../components/ui/Alert";
import { buttonClassName } from "../../../components/ui/Button";
import { ChartLoadError, ChartPlaceholder } from "../../../components/ui/LazyChart";
import { TeamCompetenceSkeleton } from "./TeamCompetenceSkeleton";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { KOMPETANSEPROFIL_COPY } from "../radar-copy";
import { RadarAreaSelector } from "./RadarAreaSelector";
import type { TeamLevelBarRow } from "./TeamLevelBarChart";
import { levelBarChartHeight } from "./team-level-bar-layout";

/**
 * The two Teamkompetanse charts are code-split: `recharts` loads only once the workspace has data to draw. The
 * fallbacks reproduce each chart's heading, description and box, so the section does not move when the chart arrives.
 */
const KompetanseprofilRadar = lazy(() =>
  import("./KompetanseprofilRadar").then((mod) => ({ default: mod.KompetanseprofilRadar })),
);
const TeamLevelBarChart = lazy(() => import("./TeamLevelBarChart").then((mod) => ({ default: mod.TeamLevelBarChart })));

const RadarBoundary = catchError(ChartLoadError);
const LevelBarBoundary = catchError(ChartLoadError);

function RadarPlaceholder() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text-primary">{KOMPETANSEPROFIL_COPY.title}</h2>
      <ChartPlaceholder className="mx-auto h-[280px] w-full max-w-[420px] min-w-[260px]" />
    </section>
  );
}

function LevelBarPlaceholder({ rowCount }: { readonly rowCount: number }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold text-text-primary">{teamCompetenceCopy.levelChart.title}</h3>
      <p className="text-sm text-text-secondary">{teamCompetenceCopy.levelChart.description}</p>
      <ChartPlaceholder className="w-full" style={{ height: levelBarChartHeight(rowCount) }} />
    </section>
  );
}
import { RADAR_MAX_AXES, type RadarAxisInput } from "../domain/radar-model";
import { resolveRadarSelection, toggleRadarSelection } from "../domain/radar-selection";
import {
  fetchTeamManualAssessments,
  fetchTeamSkillAggregate,
  fetchTeamSkills,
  type TeamManualAssessmentsStatus,
  type TeamManualAssessmentView,
  type TeamOwnedSkillAggregateStatus,
  type TeamSkillsListResult,
  type TeamSkillView,
} from "../client/team-skills-gateway";
import { teamCompetenceCopy } from "../workspace-copy";
import { TeamManualLevelEditor } from "./TeamManualLevelEditor";
import { TeamSkillsAdmin } from "./TeamSkillsAdmin";

type Mode = "automatic" | "collaborative";

/** The three server reads the page composes. Each keeps its own server-side authorization; nothing is derived here. */
interface Loaded {
  token: string;
  catalog: TeamSkillsListResult;
  automatic: TeamOwnedSkillAggregateStatus;
  manual: TeamManualAssessmentsStatus;
}

/** The radar's area choice, shared by both modes. `null` means the user has not chosen yet (the deterministic default). */
interface RadarControls {
  readonly selection: readonly string[] | null;
  readonly onChange: (next: string[]) => void;
}

const copy = teamCompetenceCopy;

/**
 * The one team competence page (unified decision, 2026-11-11). Shows the canonical team skill catalog, the automatic
 * profile (shared individual assessments, k = 3) and the collaborative profile (the team's agreed levels). Each mode shows
 * the radar (up to eight areas, selectable when more are eligible), a bar chart of every eligible level, and the complete
 * table. Suppressed and missing values are shown as such, never as zero.
 */
export function TeamCompetenceWorkspace({ teamId }: { readonly teamId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  // The current identity scope, set by the auth callback. A save confirmation is shown only while its scope is still current.
  const [scope, setScope] = useState<{ token: string; teamId: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; token: string; teamId: string } | null>(null);
  const [mode, setMode] = useState<Mode>("automatic");
  const [reloadKey, setReloadKey] = useState(0);
  const [radarSelection, setRadarSelection] = useState<string[] | null>(null);

  useAuthGatedResource(
    (token, generation, isCurrentGeneration) => {
      // Protected state is cleared on every auth change, team change or reload before anything else runs.
      setLoaded(null);
      setReadFailed(false);
      setUnauthenticated(token === null);
      setScope(token === null ? null : { token, teamId });
      // A save confirmation survives the reload that follows it, but not an account or team change.
      setNotice((previous) => (previous !== null && previous.token === token && previous.teamId === teamId ? previous : null));
      if (token === null) return;
      // A response is applied only while its authentication generation is still current. The generation is bumped on
      // sign-out, account switch, team change and reload, so a late response from any of them is discarded.
      void Promise.all([fetchTeamSkills(token, teamId), fetchTeamSkillAggregate(token, teamId), fetchTeamManualAssessments(token, teamId)]).then(
        ([catalog, automatic, manual]) => {
          if (isCurrentGeneration(generation)) setLoaded({ token, catalog, automatic, manual });
        },
        () => {
          // An unexpected rejection ends in the read-failed message, never in an indefinite skeleton.
          if (isCurrentGeneration(generation)) setReadFailed(true);
        },
      );
    },
    [teamId, reloadKey],
  );

  // Shown only for the scope that wrote it and that is still current; a late confirmation from another scope stays hidden.
  const visibleNotice =
    notice !== null && scope !== null && notice.token === scope.token && notice.teamId === scope.teamId && scope.teamId === teamId
      ? <Alert variant="success">{notice.text}</Alert>
      : null;

  if (unauthenticated) return <Alert variant="info">{copy.errors.unauthenticated}</Alert>;
  if (readFailed) return <Alert variant="info">{copy.errors.read_failed}</Alert>;
  if (loaded === null) {
    return (
      <div className="flex flex-col gap-4">
        {visibleNotice}
        <TeamCompetenceSkeleton label={copy.loading} />
      </div>
    );
  }
  if (loaded.catalog.status !== "ok") {
    const status = loaded.catalog.status;
    const message = status === "forbidden" || status === "team_disabled" || status === "unauthenticated" ? copy.errors[status] : copy.errors.read_failed;
    return <Alert variant="info">{message}</Alert>;
  }

  const activeSkills = loaded.catalog.skills.filter((skill) => skill.active);
  // Called by the manual editor only after the server confirmed a save. The reload then refreshes the page.
  const onManualSaved = (text: string) => {
    setNotice({ text, token: loaded.token, teamId });
    setReloadKey((n) => n + 1);
  };
  const radar: RadarControls = { selection: radarSelection, onChange: setRadarSelection };

  return (
    <div className="flex flex-col gap-6">
      {visibleNotice}
      <section aria-labelledby="team-competence-heading" className="flex flex-col gap-2">
        <h2 id="team-competence-heading" className="text-xl font-semibold text-text-primary">
          {copy.heading}
        </h2>
        <p className="text-sm text-text-secondary">{copy.intro}</p>
      </section>

      <div role="group" aria-label={copy.modeLabel} className="flex flex-wrap gap-2">
        {(["automatic", "collaborative"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={buttonClassName({ variant: mode === value ? "primary" : "secondary", size: "sm" })}
          >
            {copy.modes[value]}
          </button>
        ))}
      </div>
      <section aria-live="polite" className="flex flex-col gap-3">
        <p className="text-sm font-medium text-text-primary">{copy.activeMode(copy.modes[mode])}</p>
        <p className="text-sm text-text-secondary">{copy.modeDescriptions[mode]}</p>
        {mode === "automatic" ? (
          <AutomaticView skills={activeSkills} status={loaded.automatic} radar={radar} />
        ) : (
          <CollaborativeView skills={activeSkills} status={loaded.manual} radar={radar} />
        )}
      </section>

      {mode === "collaborative" && loaded.catalog.canEdit ? (
        loaded.manual.status === "ok" ? (
          <TeamManualLevelEditor
            teamId={teamId}
            token={loaded.token}
            skills={activeSkills}
            assessments={loaded.manual.assessments}
            onChanged={onManualSaved}
          />
        ) : (
          <Alert variant="info">{copy.errors.read_failed}</Alert>
        )
      ) : null}

      {loaded.catalog.canEdit ? (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold text-text-primary">{copy.admin.heading}</summary>
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-sm text-text-secondary">{copy.admin.description}</p>
            <TeamSkillsAdmin teamId={teamId} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** One area with a calculated team level in the active mode. */
interface ProfileValue {
  readonly skillId: string;
  readonly name: string;
  readonly level: number;
}

interface ListRow {
  readonly key: string;
  readonly name: string;
  readonly text: string;
  readonly note: string | null;
  readonly outdated: boolean;
}

/**
 * Automatic profile: the approved aggregate values, shown as radar, bar chart and the complete list. A suppressed or
 * missing area is left out of both charts, never plotted as zero, and is listed as "not enough data".
 */
function AutomaticView({
  skills,
  status,
  radar,
}: {
  readonly skills: readonly TeamSkillView[];
  readonly status: TeamOwnedSkillAggregateStatus;
  readonly radar: RadarControls;
}) {
  if (status.status !== "ok") {
    return <Alert variant="info">{status.status === "incomplete" ? copy.errors.incomplete : copy.errors.read_failed}</Alert>;
  }
  if (skills.length === 0) return <p className="text-sm text-text-secondary">{copy.empty}</p>;
  const byId = new Map(status.rows.map((row) => [row.skillId, row]));
  const levels = skills.map((skill) => {
    const row = byId.get(skill.skillId);
    return { skill, level: row !== undefined && row.state === "value" ? row.level : null };
  });
  const values: ProfileValue[] = levels.flatMap(({ skill, level }) =>
    level === null ? [] : [{ skillId: skill.skillId, name: skill.name, level }],
  );
  return (
    <>
      {status.includesSimulated ? <Alert variant="info">{copy.simulatedNotice}</Alert> : null}
      <ProfilePanels
        values={values}
        radar={radar}
        list={levels.map(({ skill, level }) => ({
          key: skill.skillId,
          name: skill.name,
          text: level === null ? copy.insufficient : copy.agreedLevel(level, SELF_ASSESSED_LEVEL_COPY[level].name),
          note: null,
          outdated: false,
        }))}
      />
    </>
  );
}

/** Collaborative profile: the agreed levels, shown as radar, bar chart and the complete list (agreed, or not assessed). */
function CollaborativeView({
  skills,
  status,
  radar,
}: {
  readonly skills: readonly TeamSkillView[];
  readonly status: TeamManualAssessmentsStatus;
  readonly radar: RadarControls;
}) {
  if (status.status !== "ok") return <Alert variant="info">{copy.errors.read_failed}</Alert>;
  if (skills.length === 0) return <p className="text-sm text-text-secondary">{copy.empty}</p>;
  const byId = new Map<string, TeamManualAssessmentView>(status.assessments.map((row) => [row.skillId, row]));
  const values: ProfileValue[] = skills.flatMap((skill) => {
    const row = byId.get(skill.skillId);
    return row === undefined ? [] : [{ skillId: skill.skillId, name: skill.name, level: row.level }];
  });
  return (
    <ProfilePanels
      values={values}
      radar={radar}
      list={skills.map((skill) => {
        const row = byId.get(skill.skillId);
        return {
          key: skill.skillId,
          name: skill.name,
          text: row === undefined ? copy.notAssessed : copy.agreedLevel(row.level, SELF_ASSESSED_LEVEL_COPY[row.level].name),
          note: row?.note ?? null,
          outdated: row?.outdated ?? false,
        };
      })}
    />
  );
}

/**
 * The visualizations shared by both modes. `values` holds every eligible area in catalog order. The radar draws every
 * eligible area when there are at most eight, and otherwise the user's selection (capped at eight). The selection only
 * changes what the radar draws; the bar chart and the list always use every eligible area.
 */
function ProfilePanels({
  values,
  radar,
  list,
}: {
  readonly values: readonly ProfileValue[];
  readonly radar: RadarControls;
  readonly list: readonly ListRow[];
}) {
  const eligibleIds = values.map((value) => value.skillId);
  const selectable = values.length > RADAR_MAX_AXES;
  const drawnIds = selectable ? resolveRadarSelection(eligibleIds, radar.selection) : eligibleIds;
  const axes: RadarAxisInput[] = values
    .filter((value) => drawnIds.includes(value.skillId))
    .map((value) => ({ treeId: value.skillId, label: value.name, teamLevel: value.level, targetLevel: null }));

  return (
    <>
      {selectable ? (
        <RadarAreaSelector
          options={values.map((value) => ({ skillId: value.skillId, name: value.name }))}
          selected={drawnIds}
          onToggle={(skillId) => radar.onChange(toggleRadarSelection(drawnIds, skillId))}
          onReset={() => radar.onChange(resolveRadarSelection(eligibleIds, null))}
        />
      ) : null}
      <RadarBoundary>
        <Suspense fallback={<RadarPlaceholder />}>
          <KompetanseprofilRadar axes={axes} showTable={false} />
        </Suspense>
      </RadarBoundary>
      {values.length > 0 ? (
        <LevelBarBoundary>
          <Suspense fallback={<LevelBarPlaceholder rowCount={values.length} />}>
            <TeamLevelBarChart
              rows={values.map((value): TeamLevelBarRow => ({ skillId: value.skillId, name: value.name, level: value.level }))}
            />
          </Suspense>
        </LevelBarBoundary>
      ) : null}
      <details className="group rounded-md border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {copy.fullTable.open}
        </summary>
        <div className="overflow-x-auto border-t border-border-subtle px-3 py-3">
          <LevelList rows={list} />
        </div>
      </details>
    </>
  );
}

/** The complete readable list of every active area, one table for both modes. */
function LevelList({ rows }: { readonly rows: readonly ListRow[] }) {
  return (
    <table className="min-w-full text-left text-sm">
      <caption className="sr-only">{copy.listCaption}</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-2 pr-4 font-semibold text-text-primary">
            {copy.columns.area}
          </th>
          <th scope="col" className="py-2 font-semibold text-text-primary">
            {copy.columns.level}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border-subtle align-top">
            <th scope="row" className="py-2 pr-4 font-medium text-text-primary">
              {row.name}
            </th>
            <td className="py-2 text-text-primary">
              <span>{row.text}</span>
              {row.outdated ? <span className="ml-2 text-text-secondary">({copy.outdated})</span> : null}
              {row.note !== null ? <p className="text-text-secondary">{row.note}</p> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

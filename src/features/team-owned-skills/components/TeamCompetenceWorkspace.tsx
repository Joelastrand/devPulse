"use client";

import { lazy, Suspense, useState } from "react";
import { catchError } from "next/error";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { Alert } from "../../../components/ui/Alert";
import { buttonClassName } from "../../../components/ui/Button";
import { CollapsibleSection } from "../../../components/ui/CollapsibleSection";
import { ChartLoadError, ChartPlaceholder } from "../../../components/ui/LazyChart";
import { useDisclosurePreferences } from "../../../components/ui/use-disclosure-preferences";
import { useAccountUid } from "../../auth/client/use-account-uid";
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
      <ChartPlaceholder className="mx-auto h-[300px] w-full max-w-[520px] min-w-[260px] md:h-[400px]" />
    </section>
  );
}

/** Reserves the chart's height while it loads. The heading belongs to the level section, so the placeholder has none. */
function LevelBarPlaceholder({ rowCount }: { readonly rowCount: number }) {
  return <ChartPlaceholder className="w-full" style={{ height: levelBarChartHeight(rowCount) }} />;
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
import { Select } from "../../../components/ui/Select";
import { levelExtremes, sortLevelRows, type LevelOrder } from "../domain/level-order";

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

/** What both profile modes share: the area choice, and the disclosure and chart/table view of the level section. */
interface ProfileView {
  readonly radar: RadarControls;
  readonly levelsOpen: boolean;
  readonly onLevelsOpenChange: (open: boolean) => void;
  readonly tableView: boolean;
  readonly onTableViewChange: (table: boolean) => void;
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
  // Local view preference for the lead-only administration section. Its default is collapsed.
  const uid = useAccountUid();
  // Local view preferences, scoped to this user and team. `levels` is the chart section (open by default, since it is the
  // main per-area view); `levelTable` selects the table view instead of the bar chart.
  const disclosure = useDisclosurePreferences("teamkompetanse", teamId, uid, { admin: false, levels: true, levelTable: false });

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
  const profileView: ProfileView = {
    radar,
    levelsOpen: disclosure.isOpen("levels"),
    onLevelsOpenChange: (open) => disclosure.setOpen("levels", open),
    tableView: disclosure.isOpen("levelTable"),
    onTableViewChange: (table) => disclosure.setOpen("levelTable", table),
  };

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
          <AutomaticView skills={activeSkills} status={loaded.automatic} view={profileView} />
        ) : (
          <CollaborativeView skills={activeSkills} status={loaded.manual} view={profileView} />
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
        <CollapsibleSection
          id="teamkompetanse-admin"
          headingLevel={3}
          title={copy.admin.heading}
          description={copy.admin.description}
          open={disclosure.isOpen("admin")}
          onOpenChange={(open) => disclosure.setOpen("admin", open)}
        >
          <TeamSkillsAdmin teamId={teamId} />
        </CollapsibleSection>
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
  /** The calculated level, or `null` when none is available. Missing levels are never sorted as zero. */
  readonly level: number | null;
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
  view,
}: {
  readonly skills: readonly TeamSkillView[];
  readonly status: TeamOwnedSkillAggregateStatus;
  readonly view: ProfileView;
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
        view={view}
        list={levels.map(({ skill, level }) => ({
          key: skill.skillId,
          name: skill.name,
          level,
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
  view,
}: {
  readonly skills: readonly TeamSkillView[];
  readonly status: TeamManualAssessmentsStatus;
  readonly view: ProfileView;
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
      view={view}
      list={skills.map((skill) => {
        const row = byId.get(skill.skillId);
        return {
          key: skill.skillId,
          name: skill.name,
          level: row?.level ?? null,
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
  view,
  list,
}: {
  readonly values: readonly ProfileValue[];
  readonly view: ProfileView;
  readonly list: readonly ListRow[];
}) {
  const [order, setOrder] = useState<LevelOrder>("name");
  const [showAllBars, setShowAllBars] = useState(false);
  const eligibleIds = values.map((value) => value.skillId);
  const selectable = values.length > RADAR_MAX_AXES;
  // The radar and the bar chart draw the same areas: the user's selection when there are more than the radar can show.
  const drawnIds = selectable ? resolveRadarSelection(eligibleIds, view.radar.selection) : eligibleIds;
  const axes: RadarAxisInput[] = values
    .filter((value) => drawnIds.includes(value.skillId))
    .map((value) => ({ treeId: value.skillId, label: value.name, teamLevel: value.level, targetLevel: null }));
  const barValues = selectable && !showAllBars ? values.filter((value) => drawnIds.includes(value.skillId)) : values;
  const barRows: TeamLevelBarRow[] = barValues.map((value) => ({ skillId: value.skillId, name: value.name, level: value.level }));
  // The table always lists every area, in the chosen order. Its ids come from the row keys, which are the skill ids.
  const tableRows = sortLevelRows(
    list.map((row) => ({ ...row, skillId: row.key })),
    order,
  );
  const extremes = levelExtremes(values);

  return (
    <>
      <ProfileSummary extremes={extremes} withData={values.length} total={list.length} />
      {selectable ? (
        <RadarAreaSelector
          options={values.map((value) => ({ skillId: value.skillId, name: value.name }))}
          selected={drawnIds}
          onToggle={(skillId) => view.radar.onChange(toggleRadarSelection(drawnIds, skillId))}
          onReset={() => view.radar.onChange(resolveRadarSelection(eligibleIds, null))}
        />
      ) : null}
      <RadarBoundary>
        <Suspense fallback={<RadarPlaceholder />}>
          {/* The radar's own table is its text alternative: the same drawn areas, readable without the chart or any disclosure. */}
          <KompetanseprofilRadar axes={axes} showTable />
        </Suspense>
      </RadarBoundary>
      <CollapsibleSection
        id="teamkompetanse-levels"
        headingLevel={3}
        title={copy.levelChart.title}
        description={copy.levelChart.description}
        open={view.levelsOpen}
        onOpenChange={view.onLevelsOpenChange}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div role="group" aria-label={copy.levelChart.viewLabel} className="inline-flex rounded-control border border-border-strong p-0.5">
              {(["chart", "table"] as const).map((value) => {
                const pressed = value === "table" ? view.tableView : !view.tableView;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => view.onTableViewChange(value === "table")}
                    className={buttonClassName({ variant: pressed ? "primary" : "tertiary", size: "sm" })}
                  >
                    {copy.levelChart.view[value]}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Select id="teamkompetanse-level-sort" label={copy.levelChart.sortLabel} value={order} onChange={(event) => setOrder(event.target.value as LevelOrder)}>
                <option value="name">{copy.levelChart.sort.name}</option>
                <option value="level-desc">{copy.levelChart.sort.levelDesc}</option>
                <option value="level-asc">{copy.levelChart.sort.levelAsc}</option>
              </Select>
              {selectable && !view.tableView ? (
                <button type="button" onClick={() => setShowAllBars((current) => !current)} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                  {showAllBars ? copy.levelChart.showSelected : copy.levelChart.showAll(values.length)}
                </button>
              ) : null}
            </div>
          </div>
          <p className="text-help text-text-secondary">{copy.levelChart.sortHint}</p>
          {view.tableView ? (
            <div className="overflow-x-auto">
              <LevelList rows={tableRows} />
            </div>
          ) : (
            <>
              {selectable && !showAllBars ? (
                <p className="text-help text-text-secondary">{copy.levelChart.chartLimited(barValues.length, values.length)}</p>
              ) : null}
              {barRows.length > 0 ? (
                <LevelBarBoundary>
                  <Suspense fallback={<LevelBarPlaceholder rowCount={barRows.length} />}>
                    <TeamLevelBarChart rows={barRows} order={order} />
                  </Suspense>
                </LevelBarBoundary>
              ) : null}
            </>
          )}
        </div>
      </CollapsibleSection>
    </>
  );
}

/**
 * The compact summary above the charts. It uses only the calculated values already on screen: suppressed or missing areas
 * are not counted, and a missing level is never treated as the lowest. Ties are stated, not hidden.
 */
function ProfileSummary({
  extremes,
  withData,
  total,
}: {
  readonly extremes: ReturnType<typeof levelExtremes>;
  readonly withData: number;
  readonly total: number;
}) {
  return (
    <section aria-label={copy.summary.label} className="flex flex-col gap-1 rounded-control bg-surface-subtle px-4 py-3 text-sm text-text-primary">
      {withData === 0 || extremes === null ? (
        <p>{copy.summary.noData}</p>
      ) : (
        <ul className="flex flex-wrap gap-x-6 gap-y-1">
          <li>{copy.summary.withData(withData, total)}</li>
          <li>
            {copy.summary.highest(extremes.highest.name, extremes.highest.level)}
            {extremes.highest.tied > 1 ? `, ${copy.summary.tied(extremes.highest.tied)}` : ""}
          </li>
          {withData >= 2 ? (
            <li>
              {copy.summary.lowest(extremes.lowest.name, extremes.lowest.level)}
              {extremes.lowest.tied > 1 ? `, ${copy.summary.tied(extremes.lowest.tied)}` : ""}
            </li>
          ) : null}
        </ul>
      )}
    </section>
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

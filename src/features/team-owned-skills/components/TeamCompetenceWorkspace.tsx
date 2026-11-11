"use client";

import { useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { Alert } from "../../../components/ui/Alert";
import { buttonClassName } from "../../../components/ui/Button";
import { LoadingState } from "../../../components/ui/LoadingState";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { KompetanseprofilRadar } from "./KompetanseprofilRadar";
import type { RadarAxisInput } from "../domain/radar-model";
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

const copy = teamCompetenceCopy;

/**
 * The one team competence page (unified decision, 2026-11-11). Shows the canonical team skill catalog, the automatic
 * profile (shared individual assessments, k = 3) and the collaborative profile (the team's agreed levels), with one radar
 * and one readable list for the active mode. Suppressed and missing values are shown as such, never as zero.
 */
export function TeamCompetenceWorkspace({ teamId }: { readonly teamId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [mode, setMode] = useState<Mode>("automatic");
  const [reloadKey, setReloadKey] = useState(0);

  useAuthGatedResource(
    (token) => {
      setLoaded(null);
      setUnauthenticated(token === null);
      if (token === null) return;
      void Promise.all([fetchTeamSkills(token, teamId), fetchTeamSkillAggregate(token, teamId), fetchTeamManualAssessments(token, teamId)]).then(
        ([catalog, automatic, manual]) => setLoaded({ token, catalog, automatic, manual }),
      );
    },
    [teamId, reloadKey],
  );

  if (unauthenticated) return <Alert variant="info">{copy.errors.unauthenticated}</Alert>;
  if (loaded === null) return <LoadingState label={copy.loading} />;
  if (loaded.catalog.status !== "ok") {
    const status = loaded.catalog.status;
    const message = status === "forbidden" || status === "team_disabled" || status === "unauthenticated" ? copy.errors[status] : copy.errors.read_failed;
    return <Alert variant="info">{message}</Alert>;
  }

  const activeSkills = loaded.catalog.skills.filter((skill) => skill.active);
  const onChanged = () => setReloadKey((n) => n + 1);

  return (
    <div className="flex flex-col gap-6">
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
          <AutomaticView skills={activeSkills} status={loaded.automatic} />
        ) : (
          <CollaborativeView skills={activeSkills} status={loaded.manual} />
        )}
      </section>

      {mode === "collaborative" && loaded.catalog.canEdit ? (
        loaded.manual.status === "ok" ? (
          <TeamManualLevelEditor
            teamId={teamId}
            token={loaded.token}
            skills={activeSkills}
            assessments={loaded.manual.assessments}
            onChanged={onChanged}
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

/** Automatic profile: radar of the approved aggregate values, plus the list of every active skill with its state. */
function AutomaticView({ skills, status }: { readonly skills: readonly TeamSkillView[]; readonly status: TeamOwnedSkillAggregateStatus }) {
  if (status.status !== "ok") {
    return <Alert variant="info">{status.status === "incomplete" ? copy.errors.incomplete : copy.errors.read_failed}</Alert>;
  }
  if (skills.length === 0) return <p className="text-sm text-text-secondary">{copy.empty}</p>;
  // A suppressed or missing skill is left out of the radar, never plotted as zero, and is listed as "not enough data".
  const byId = new Map(status.rows.map((row) => [row.skillId, row]));
  const levels = skills.map((skill) => {
    const row = byId.get(skill.skillId);
    return { skill, level: row !== undefined && row.state === "value" ? row.level : null };
  });
  const axes: RadarAxisInput[] = levels.flatMap(({ skill, level }) =>
    level === null ? [] : [{ treeId: skill.skillId, label: skill.name, teamLevel: level, targetLevel: null }],
  );
  return (
    <>
      <KompetanseprofilRadar axes={axes} showTable={false} />
      <LevelList
        rows={levels.map(({ skill, level }) => ({
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

/** Collaborative profile: radar of the agreed levels, plus the list of every active skill (agreed, or not assessed). */
function CollaborativeView({ skills, status }: { readonly skills: readonly TeamSkillView[]; readonly status: TeamManualAssessmentsStatus }) {
  if (status.status !== "ok") return <Alert variant="info">{copy.errors.read_failed}</Alert>;
  if (skills.length === 0) return <p className="text-sm text-text-secondary">{copy.empty}</p>;
  const byId = new Map<string, TeamManualAssessmentView>(status.assessments.map((row) => [row.skillId, row]));
  const axes: RadarAxisInput[] = skills.flatMap((skill) => {
    const row = byId.get(skill.skillId);
    return row === undefined ? [] : [{ treeId: skill.skillId, label: skill.name, teamLevel: row.level, targetLevel: null }];
  });
  return (
    <>
      <KompetanseprofilRadar axes={axes} showTable={false} />
      <LevelList
        rows={skills.map((skill) => {
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
    </>
  );
}

interface ListRow {
  readonly key: string;
  readonly name: string;
  readonly text: string;
  readonly note: string | null;
  readonly outdated: boolean;
}

/** The readable list of the displayed values, one table for both modes. */
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

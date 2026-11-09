"use client";

import { buildCollaborativeAxes, type CompetenceAreaForProfile } from "../domain/collaborative-profile";
import { COLLABORATIVE_PANEL_COPY } from "../copy";
import { useCollaborativeTeamData } from "../client/use-collaborative-team-data";
import { KompetanseprofilRadar } from "./KompetanseprofilRadar";
import { TeamCompetenceProfile } from "./TeamCompetenceProfile";
import { CollaborativeLevelEditor, type LevelEditorRow } from "./CollaborativeLevelEditor";
import { CompetenceAreaManager } from "./CompetenceAreaManager";

/**
 * Teamkompetanse panel that follows the team's stored mode. Automatic mode shows the existing automatic panel. Collaborative
 * mode shows the radar of the teamadmin-entered levels, and, for a teamadmin, the level editor and area management. Every
 * write is re-checked by the server; `canEdit` only decides which controls are shown.
 */
export function CollaborativeCompetenceProfile({ teamId }: { readonly teamId: string }) {
  const { phase, token, current, reload } = useCollaborativeTeamData(teamId);

  if (phase === "loading" || (token !== null && current === null)) {
    return <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.loading}</p>;
  }
  if (phase === "signed_out" || current === null || token === null) {
    return <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.unauthenticated}</p>;
  }
  if (current.profile.status !== "ok" || current.areas.status !== "ok") {
    const refused = current.profile.status === "forbidden" || current.areas.status === "forbidden";
    return <p className="text-sm text-text-secondary">{refused ? COLLABORATIVE_PANEL_COPY.forbidden : COLLABORATIVE_PANEL_COPY.readFailed}</p>;
  }

  const { mode, levels } = current.profile;
  const { areas, canEdit } = current.areas;
  if (mode === "automatic") {
    return (
      <section className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.automaticHint}</p>
        <TeamCompetenceProfile teamId={teamId} />
      </section>
    );
  }

  const levelByTree = new Map(levels.map((entry) => [entry.treeId, entry.level]));
  const profileAreas: CompetenceAreaForProfile[] = areas.map((area) => ({
    treeId: area.treeId,
    label: area.name ?? COLLABORATIVE_PANEL_COPY.unnamedArea,
    status: area.status,
    teamLevel: levelByTree.get(area.treeId) ?? null,
  }));
  const axes = buildCollaborativeAxes(profileAreas, []);
  const activeAreas = profileAreas.filter((area) => area.status === "active");
  const editorRows: LevelEditorRow[] = areas
    .filter((area) => area.status === "active")
    .map((area) => ({
      treeId: area.treeId,
      label: area.name ?? COLLABORATIVE_PANEL_COPY.unnamedArea,
      teamLevel: levelByTree.get(area.treeId) ?? null,
    }));
  const anyLevelSet = activeAreas.some((area) => area.teamLevel !== null);

  const setLevels = activeAreas.flatMap((area) => (area.teamLevel === null ? [] : [area.teamLevel]));
  const averageLevel = setLevels.length === 0 ? null : setLevels.reduce((sum, level) => sum + level, 0) / setLevels.length;

  return (
    <section className="flex flex-col gap-8">
      {anyLevelSet ? null : <p className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.radarEmpty}</p>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-surface border border-border-subtle bg-surface p-6 shadow-card">
          <KompetanseprofilRadar axes={axes} showTable={false} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:self-start rounded-surface border border-border-subtle bg-surface p-6 shadow-card">
          <h2 className="text-lg font-semibold text-text-primary">{COLLABORATIVE_PANEL_COPY.keyFiguresHeading}</h2>
          <dl className="flex flex-col gap-4">
            <div>
              <dt className="text-2xl font-semibold text-text-primary">
                {COLLABORATIVE_PANEL_COPY.areasSetLabel(setLevels.length, activeAreas.length)}
              </dt>
              <dd className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.areasSetDescription}</dd>
            </div>
            <div>
              <dt className="text-2xl font-semibold text-text-primary">
                {averageLevel === null ? COLLABORATIVE_PANEL_COPY.perAreaUnset : COLLABORATIVE_PANEL_COPY.averageLabel(averageLevel.toFixed(1))}
              </dt>
              <dd className="text-sm text-text-secondary">{COLLABORATIVE_PANEL_COPY.averageDescription}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-surface border border-border-subtle bg-surface p-6 shadow-card">
        <h2 className="text-lg font-semibold text-text-primary">{COLLABORATIVE_PANEL_COPY.perAreaHeading}</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              <th scope="col" className="py-2 font-medium">{COLLABORATIVE_PANEL_COPY.perAreaColumnArea}</th>
              <th scope="col" className="py-2 font-medium">{COLLABORATIVE_PANEL_COPY.perAreaColumnLevel}</th>
            </tr>
          </thead>
          <tbody>
            {activeAreas.map((area) => (
              <tr key={area.treeId} className="border-b border-border-subtle last:border-b-0">
                <td className="py-3 pr-4 text-text-primary">{area.label}</td>
                <td className="py-3 text-text-secondary">
                  {area.teamLevel === null ? (
                    COLLABORATIVE_PANEL_COPY.perAreaUnset
                  ) : (
                    <div className="flex items-center gap-3">
                      <span aria-hidden="true" className="h-2 w-12 shrink-0 overflow-hidden rounded-full bg-surface-subtle sm:w-40">
                        <span className="block h-full bg-primary" style={{ width: `${(area.teamLevel / 4) * 100}%` }} />
                      </span>
                      <span className="whitespace-nowrap">{COLLABORATIVE_PANEL_COPY.perAreaLevel(area.teamLevel)}</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <>
          <CollaborativeLevelEditor teamId={teamId} token={token} rows={editorRows} onSaved={reload} />
          <CompetenceAreaManager teamId={teamId} token={token} areas={areas} onChanged={reload} />
        </>
      ) : null}
    </section>
  );
}

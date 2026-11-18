"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { SystemListSkeleton } from "./SystemListSkeleton";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { TeamPageHeader } from "../../teams/components/TeamPageHeader";
import { fetchTeamSystems, type TeamSystemsReadResult } from "../client/team-systems-gateway";
import { useSystemFavorites, type SystemFavoritesState } from "../client/use-system-favorites";
import { systemsCopy } from "../copy";
import {
  DEFAULT_SYSTEM_FILTER,
  filterSystems,
  summarizeSystems,
  type SystemFilter,
  type SystemSummaryInput,
} from "../domain/team-system-summary";
import {
  SYSTEM_PAGE_SIZE_MAX,
  SYSTEM_PAGE_SIZE_STEP,
  parseSystemListQuery,
  serializeSystemListQuery,
  systemsListHref,
  type SystemListState,
} from "../domain/system-list-query";
import { ASSESSMENT_ATTRIBUTES } from "../domain/team-system";
import type { TeamSystemView } from "../server/list-team-systems";
import { SystemFilters } from "./SystemFilters";
import { SystemEditorPanel } from "./SystemEditorPanel";
import { KnowledgeRiskPanel, QualityPanel, SystemSummaryCards } from "./SystemInsights";
import { SystemList } from "./SystemList";

const NO_FAVORITES: ReadonlySet<string> = new Set();

type ViewState =
  | { phase: "loading" }
  | { phase: "signed_out" }
  | { phase: "signed_in"; token: string };

/**
 * `/teams/[teamId]/systems` shell: auth gating and the shared team navigation.
 * The data read lives in `SystemsContent`, keyed by token and team, so a sign-out
 * or team change discards everything in flight (BR-2).
 */
export function TeamSystemsPage({ teamId }: { teamId: string }) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });

  useAuthGatedResource(
    (token) => {
      setState(token ? { phase: "signed_in", token } : { phase: "signed_out" });
    },
    [teamId],
  );

  return (
    <div className="flex flex-col gap-6">
      <TeamPageHeader teamId={teamId} />
      <p className="text-text-secondary">{systemsCopy.pageDescription}</p>
      {state.phase === "loading" && <SystemListSkeleton label={systemsCopy.loading} />}
      {state.phase === "signed_out" && (
        <p className="text-text-secondary">
          <Link href="/sign-in" className="font-medium text-text-primary underline">
            {systemsCopy.signInLink}
          </Link>{" "}
          {systemsCopy.signInPrompt}
        </p>
      )}
      {state.phase === "signed_in" && <SystemsContent key={`${state.token}:${teamId}`} token={state.token} teamId={teamId} />}
    </div>
  );
}

type ListState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "forbidden" }
  | { phase: "loaded"; systems: TeamSystemView[]; canEdit: boolean; truncated: boolean };

function toListState(result: TeamSystemsReadResult): ListState {
  if (result.status === "ok") {
    return { phase: "loaded", systems: result.systems, canEdit: result.canEdit, truncated: result.truncated };
  }
  if (result.status === "forbidden") return { phase: "forbidden" };
  return { phase: "error" };
}

/** The list opens the create form only. Existing systems are edited on their detail page. */
type FormState = { mode: "create" } | null;

function toSummaryInput(system: TeamSystemView): SystemSummaryInput {
  return {
    name: system.name,
    description: system.description,
    knowledgeRisk: system.knowledgeRisk,
    knowledgeCount: system.knowledge.length,
    attention: system.attention,
    inGoodStanding: ASSESSMENT_ATTRIBUTES.every((attribute) => system.assessments[attribute].value === "god"),
    classification: system.classification,
  };
}

function SystemsContent({ token, teamId }: { token: string; teamId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [list, setList] = useState<ListState>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  // The browsing state (search, filters, favorites-only, rows shown) lives in the URL, so returning from a detail page or
  // reloading keeps it. The initial value is read from the URL once, when this content mounts for the token and team.
  const [listState, setListState] = useState<SystemListState>(() => parseSystemListQuery(searchParams));
  const favorites = useSystemFavorites(token, teamId);
  const [form, setForm] = useState<FormState>(null);
  const [saved, setSaved] = useState(false);

  function commitListState(next: SystemListState) {
    setListState(next);
    router.replace(systemsListHref(teamId, next), { scroll: false });
  }

  useEffect(() => {
    let cancelled = false;
    fetchTeamSystems(token, teamId).then((result) => {
      if (!cancelled) setList(toListState(result));
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId, reloadKey]);

  if (list.phase === "loading") {
    return <SystemListSkeleton label={systemsCopy.loading} />;
  }
  if (list.phase === "forbidden") {
    return <Alert variant="error">{systemsCopy.forbidden}</Alert>;
  }
  if (list.phase === "error") {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="error">{systemsCopy.readError}</Alert>
        <Button type="button" variant="secondary" className="w-fit" onClick={() => setReloadKey((key) => key + 1)}>
          {systemsCopy.retry}
        </Button>
      </div>
    );
  }

  return (
    <LoadedSystems
      token={token}
      teamId={teamId}
      systems={list.systems}
      canEdit={list.canEdit}
      truncated={list.truncated}
      listState={listState}
      onListStateChange={commitListState}
      favorites={favorites}
      form={form}
      onOpenForm={(next) => {
        setSaved(false);
        setForm(next);
      }}
      saved={saved}
      onSaved={() => {
        setForm(null);
        setSaved(true);
        setReloadKey((key) => key + 1);
      }}
    />
  );
}

interface LoadedSystemsProps {
  token: string;
  teamId: string;
  systems: TeamSystemView[];
  canEdit: boolean;
  truncated: boolean;
  listState: SystemListState;
  onListStateChange: (next: SystemListState) => void;
  favorites: SystemFavoritesState;
  form: FormState;
  onOpenForm: (next: FormState) => void;
  saved: boolean;
  onSaved: () => void;
}

function LoadedSystems({
  token,
  teamId,
  systems,
  canEdit,
  truncated,
  listState,
  onListStateChange,
  favorites,
  form,
  onOpenForm,
  saved,
  onSaved,
}: LoadedSystemsProps) {
  const { filter, pageSize } = listState;
  const favoriteIds = favorites.load.status === "ready" ? favorites.load.ids : NO_FAVORITES;
  const summary = useMemo(() => summarizeSystems(systems.map(toSummaryInput)), [systems]);
  const visible = useMemo(() => filterSystems(systems, filter, favoriteIds), [systems, filter, favoriteIds]);
  // Progressive disclosure: only the first page of matches is rendered. A filter change starts again from the first page, so
  // the count and the "Vis flere" control always describe the current matches. The page size is part of the URL state.
  const shownSystems = visible.slice(0, pageSize);
  const returnQuery = serializeSystemListQuery(listState);
  function changeFilter(next: SystemFilter) {
    onListStateChange({ filter: next, pageSize: SYSTEM_PAGE_SIZE_STEP });
  }
  function showMore() {
    onListStateChange({ filter, pageSize: Math.min(pageSize + SYSTEM_PAGE_SIZE_STEP, SYSTEM_PAGE_SIZE_MAX) });
  }
  const hasAnySystem = systems.length > 0;
  const hasAssessment = systems.some((system) => ASSESSMENT_ATTRIBUTES.some((a) => system.assessments[a].value !== "ikke_vurdert"));

  return (
    <div className="flex flex-col gap-6">
      {canEdit && form === null && (
        <div className="flex justify-end">
          <Button type="button" variant="primary" onClick={() => onOpenForm({ mode: "create" })}>
            {systemsCopy.addSystem}
          </Button>
        </div>
      )}

      {saved && form === null && <Alert variant="success">{systemsCopy.form.saved}</Alert>}
      {truncated && <Alert variant="info">{systemsCopy.truncated}</Alert>}
      {favorites.load.status === "error" && <Alert variant="error">{systemsCopy.favorites.loadError}</Alert>}
      {favorites.failure !== null && <Alert variant="error">{systemsCopy.favorites.writeError[favorites.failure.error]}</Alert>}

      {form !== null && (
        <SystemEditorPanel
          token={token}
          teamId={teamId}
          system={null}
          onCancel={() => onOpenForm(null)}
          onSaved={onSaved}
        />
      )}

      <SystemSummaryCards summary={summary} />

      {hasAnySystem ? (
        <section aria-label="Systemliste" className="flex flex-col gap-4 rounded-surface border border-border-subtle bg-surface p-4 shadow-card md:p-6">
          <div className="flex flex-col gap-3">
            <SystemFilters filter={filter} onChange={changeFilter} />
          </div>
          {!hasAssessment && <p className="text-help text-text-muted">{systemsCopy.empty.noAssessmentsBody}</p>}
          {visible.length === 0 ? (
            <EmptyState>
              <span className="block font-medium text-text-primary">{systemsCopy.empty.noSearchResultsTitle}</span>
              {systemsCopy.empty.noSearchResultsBody}
              <div className="mt-3">
                <Button type="button" variant="secondary" size="sm" onClick={() => changeFilter(DEFAULT_SYSTEM_FILTER)}>
                  {systemsCopy.list.resetFilters}
                </Button>
              </div>
            </EmptyState>
          ) : (
            <>
              <p className="text-help text-text-muted" aria-live="polite">
                {systemsCopy.list.showing(shownSystems.length, visible.length)}
              </p>
              <SystemList
                teamId={teamId}
                systems={shownSystems}
                returnQuery={returnQuery}
                favoriteIds={favoriteIds}
                favoritesReady={favorites.load.status === "ready"}
                pendingFavoriteIds={favorites.pendingIds}
                onToggleFavorite={(system, favorite) => void favorites.toggle(system.systemId, favorite)}
              />
              {shownSystems.length < visible.length && (
                <div className="flex justify-center">
                  <Button type="button" variant="secondary" onClick={showMore}>
                    {systemsCopy.list.showMore}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <EmptyState>
          <span className="block font-medium text-text-primary">{systemsCopy.empty.noSystemsTitle}</span>
          {canEdit ? systemsCopy.empty.noSystemsBody : null}
        </EmptyState>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <KnowledgeRiskPanel summary={summary} />
        <QualityPanel />
      </div>
    </div>
  );
}


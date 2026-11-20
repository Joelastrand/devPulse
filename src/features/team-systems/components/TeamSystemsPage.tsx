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
  SYSTEM_SORTS,
  filterSystems,
  sortSystems,
  summarizeSystems,
  type SystemFilter,
  type SystemSort,
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
import { useDisclosurePreferences, type DisclosurePreferences } from "../../../components/ui/use-disclosure-preferences";
import { useAccountUid } from "../../auth/client/use-account-uid";
import { SystemList } from "./SystemList";
import { SystemOverview } from "./SystemOverview";
import { Select } from "../../../components/ui/Select";

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
  // Local view preferences for the explanatory panels. Knowledge risk shows counts, so it starts open; quality is explanatory, so it starts collapsed.
  const uid = useAccountUid();
  // `detailTable` selects the detailed table instead of the overview. It is a per-user, per-team view preference.
  const systemsDisclosure = useDisclosurePreferences("systemoversikt", teamId, uid, {
    knowledgeRisk: true,
    quality: false,
    detailTable: false,
  });
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
      detailView={systemsDisclosure.isOpen("detailTable")}
      onDetailViewChange={(detail) => systemsDisclosure.setOpen("detailTable", detail)}
      systemsDisclosure={systemsDisclosure}
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
  /** True for the detailed table, false for the overview. */
  detailView: boolean;
  onDetailViewChange: (detail: boolean) => void;
  /** The page's scoped section preferences; the explanatory panels read their open state from it. */
  systemsDisclosure: DisclosurePreferences;
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
  detailView,
  onDetailViewChange,
  systemsDisclosure,
  favorites,
  form,
  onOpenForm,
  saved,
  onSaved,
}: LoadedSystemsProps) {
  const { filter, pageSize, sort } = listState;
  const favoriteIds = favorites.load.status === "ready" ? favorites.load.ids : NO_FAVORITES;
  const summary = useMemo(() => summarizeSystems(systems.map(toSummaryInput)), [systems]);
  // Filter first, then sort the matches. Both overview and table read this one array, so they always agree.
  const visible = useMemo(() => sortSystems(filterSystems(systems, filter, favoriteIds), sort), [systems, filter, favoriteIds, sort]);
  // Progressive disclosure: only the first page of matches is rendered. A filter change starts again from the first page, so
  // the count and the "Vis flere" control always describe the current matches. The page size is part of the URL state.
  const shownSystems = visible.slice(0, pageSize);
  const returnQuery = serializeSystemListQuery(listState);
  function changeFilter(next: SystemFilter) {
    onListStateChange({ filter: next, pageSize: SYSTEM_PAGE_SIZE_STEP, sort });
  }
  function changeSort(next: SystemSort) {
    onListStateChange({ filter, pageSize: SYSTEM_PAGE_SIZE_STEP, sort: next });
  }
  function showMore() {
    onListStateChange({ filter, pageSize: Math.min(pageSize + SYSTEM_PAGE_SIZE_STEP, SYSTEM_PAGE_SIZE_MAX), sort });
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
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div role="group" aria-label={systemsCopy.view.label} className="inline-flex rounded-control border border-border-strong p-0.5">
              {(["overview", "detail"] as const).map((value) => {
                const pressed = value === "detail" ? detailView : !detailView;
                return (
                  <Button
                    key={value}
                    type="button"
                    variant={pressed ? "primary" : "tertiary"}
                    size="sm"
                    aria-pressed={pressed}
                    onClick={() => onDetailViewChange(value === "detail")}
                  >
                    {systemsCopy.view[value]}
                  </Button>
                );
              })}
            </div>
            <Select id="system-sort" label={systemsCopy.sort.label} value={sort} onChange={(event) => changeSort(event.target.value as SystemSort)}>
              {SYSTEM_SORTS.map((option) => (
                <option key={option} value={option}>
                  {systemsCopy.sort[option]}
                </option>
              ))}
            </Select>
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
              {detailView ? (
                <SystemList
                  teamId={teamId}
                  systems={shownSystems}
                  returnQuery={returnQuery}
                  favoriteIds={favoriteIds}
                  favoritesReady={favorites.load.status === "ready"}
                  pendingFavoriteIds={favorites.pendingIds}
                  onToggleFavorite={(system, favorite) => void favorites.toggle(system.systemId, favorite)}
                />
              ) : (
                <SystemOverview
                  teamId={teamId}
                  systems={shownSystems}
                  returnQuery={returnQuery}
                  favoriteIds={favoriteIds}
                  favoritesReady={favorites.load.status === "ready"}
                  pendingFavoriteIds={favorites.pendingIds}
                  onToggleFavorite={(system, favorite) => void favorites.toggle(system.systemId, favorite)}
                />
              )}
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
        <KnowledgeRiskPanel
          summary={summary}
          open={systemsDisclosure.isOpen("knowledgeRisk")}
          onOpenChange={(open) => systemsDisclosure.setOpen("knowledgeRisk", open)}
        />
        <QualityPanel open={systemsDisclosure.isOpen("quality")} onOpenChange={(open) => systemsDisclosure.setOpen("quality", open)} />
      </div>
    </div>
  );
}


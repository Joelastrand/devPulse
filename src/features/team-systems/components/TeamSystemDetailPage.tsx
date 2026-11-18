"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Icon } from "../../../components/ui/Icon";
import { LoadingRegion, Skeleton, SkeletonCard, SkeletonText } from "../../../components/ui/Skeleton";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { TeamPageHeader } from "../../teams/components/TeamPageHeader";
import { fetchTeamSystems, type TeamSystemsReadResult } from "../client/team-systems-gateway";
import { useSystemFavorites } from "../client/use-system-favorites";
import { returnStateFrom, systemsListHref, type SystemListState } from "../domain/system-list-query";
import { ASSESSMENT_ATTRIBUTES, ASSESSMENT_ATTRIBUTE_LABELS } from "../domain/team-system";
import type { TeamSystemView } from "../server/list-team-systems";
import { systemsCopy } from "../copy";
import { AssessmentBadge, BackstageLink, KnowledgeSummary, RiskBadge } from "./SystemStatusBadges";
import { SystemEditorPanel } from "./SystemEditorPanel";
import { SystemClassificationLine } from "./SystemList";

type ViewState = { phase: "loading" } | { phase: "signed_out" } | { phase: "signed_in"; token: string };

type DetailState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "forbidden" }
  | { phase: "missing" }
  | { phase: "loaded"; system: TeamSystemView; canEdit: boolean };

/**
 * `/teams/[teamId]/systems/[systemId]`. The page reads the team's systems through the same authorized gateway as the list,
 * then shows the one whose id matches. A system id that is not in the team's list (missing, or belonging to another team)
 * renders as "not found", so the page never reveals another team's data. Editing reuses the list's editor panel.
 */
export function TeamSystemDetailPage({ teamId, systemId }: { teamId: string; systemId: string }) {
  const [state, setState] = useState<ViewState>({ phase: "loading" });
  const searchParams = useSearchParams();
  // The `from` parameter is the list state the user came from. It is parsed like any other input: unknown values fall back
  // to the default list, and the back link is rebuilt under this team's own route, so it cannot point elsewhere.
  const returnState = returnStateFrom(searchParams.get("from"));

  useAuthGatedResource(
    (token) => {
      setState(token ? { phase: "signed_in", token } : { phase: "signed_out" });
    },
    [teamId, systemId],
  );

  return (
    <div className="flex flex-col gap-6">
      <TeamPageHeader teamId={teamId} />
      <BackLink teamId={teamId} returnState={returnState} />
      {state.phase === "loading" && <DetailSkeleton label={systemsCopy.loading} />}
      {state.phase === "signed_out" && (
        <p className="text-text-secondary">
          <Link href="/sign-in" className="font-medium text-text-primary underline">
            {systemsCopy.signInLink}
          </Link>{" "}
          {systemsCopy.signInPrompt}
        </p>
      )}
      {state.phase === "signed_in" && (
        <DetailContent key={`${state.token}:${teamId}:${systemId}`} token={state.token} teamId={teamId} systemId={systemId} />
      )}
    </div>
  );
}

function BackLink({ teamId, returnState }: { teamId: string; returnState: SystemListState }) {
  return (
    <Link
      href={systemsListHref(teamId, returnState)}
      className="w-fit text-label font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {systemsCopy.detail.back}
    </Link>
  );
}

function DetailSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-4">
      <SkeletonCard className="flex flex-col gap-4">
        <Skeleton className="h-6 w-1/2" />
        <SkeletonText lines={2} />
        <Skeleton className="h-4 w-1/3" />
      </SkeletonCard>
    </LoadingRegion>
  );
}

/** The personal favorite toggle on the detail page. The text states the action; the filled star marks the confirmed state. */
function FavoriteToggle({
  name,
  isFavorite,
  disabled,
  onToggle,
}: {
  name: string;
  isFavorite: boolean;
  disabled: boolean;
  onToggle: (favorite: boolean) => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? systemsCopy.favorites.remove(name) : systemsCopy.favorites.add(name)}
      onClick={() => onToggle(!isFavorite)}
      className="gap-2"
    >
      <Icon icon={Star} size="inline" className={isFavorite ? "fill-current text-primary" : undefined} />
      {isFavorite ? "Fjern favoritt" : "Legg til favoritt"}
    </Button>
  );
}

function toDetailState(result: TeamSystemsReadResult, systemId: string): DetailState {
  if (result.status === "forbidden") return { phase: "forbidden" };
  if (result.status !== "ok") return { phase: "error" };
  const system = result.systems.find((candidate) => candidate.systemId === systemId);
  return system ? { phase: "loaded", system, canEdit: result.canEdit } : { phase: "missing" };
}

function DetailContent({ token, teamId, systemId }: { token: string; teamId: string; systemId: string }) {
  const [detail, setDetail] = useState<DetailState>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const favorites = useSystemFavorites(token, teamId);

  useEffect(() => {
    let cancelled = false;
    fetchTeamSystems(token, teamId).then((result) => {
      if (!cancelled) setDetail(toDetailState(result, systemId));
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId, systemId, reloadKey]);

  if (detail.phase === "loading") return <DetailSkeleton label={systemsCopy.loading} />;
  if (detail.phase === "forbidden") return <Alert variant="error">{systemsCopy.forbidden}</Alert>;
  if (detail.phase === "error") {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="error">{systemsCopy.readError}</Alert>
        <Button type="button" variant="secondary" className="w-fit" onClick={() => setReloadKey((key) => key + 1)}>
          {systemsCopy.retry}
        </Button>
      </div>
    );
  }
  if (detail.phase === "missing") {
    return (
      <EmptyState>
        <span className="block font-medium text-text-primary">{systemsCopy.detail.missingTitle}</span>
        {systemsCopy.detail.missingBody}
      </EmptyState>
    );
  }

  const { system, canEdit } = detail;
  return (
    <div className="flex flex-col gap-6">
      {saved && !editing && <Alert variant="success">{systemsCopy.form.saved}</Alert>}

      {editing ? (
        <SystemEditorPanel
          token={token}
          teamId={teamId}
          system={system}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
            setReloadKey((key) => key + 1);
          }}
        />
      ) : (
        <section aria-labelledby="system-detail-heading" className="flex flex-col gap-6 rounded-surface border border-border-subtle bg-surface p-4 shadow-card md:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-2">
              <h2 id="system-detail-heading" className="text-section-title font-semibold text-text-primary">
                {system.name}
              </h2>
              <p className="text-label text-text-secondary">{system.description ?? systemsCopy.empty.noDescription}</p>
              <SystemClassificationLine classification={system.classification} />
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <FavoriteToggle
                name={system.name}
                isFavorite={favorites.load.status === "ready" && favorites.load.ids.has(system.systemId)}
                disabled={favorites.load.status !== "ready" || favorites.pendingIds.has(system.systemId)}
                onToggle={(favorite) => void favorites.toggle(system.systemId, favorite)}
              />
              {canEdit && (
                <Button type="button" variant="secondary" onClick={() => setEditing(true)} aria-label={`${systemsCopy.detail.edit}: ${system.name}`}>
                  {systemsCopy.detail.edit}
                </Button>
              )}
            </div>
          </div>
          {favorites.load.status === "error" && <Alert variant="error">{systemsCopy.favorites.loadError}</Alert>}
          {favorites.failure !== null && <Alert variant="error">{systemsCopy.favorites.writeError[favorites.failure.error]}</Alert>}

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="text-help text-text-muted">{systemsCopy.columns.knowledge}</dt>
              <dd className="flex flex-col gap-1">
                <RiskBadge band={system.knowledgeRisk} />
                <span className="text-help text-text-secondary">
                  <KnowledgeSummary names={system.knowledge.map((member) => member.displayName)} count={system.knowledge.length} />
                </span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-help text-text-muted">{systemsCopy.columns.backstage}</dt>
              <dd>
                <BackstageLink url={system.backstageUrl} systemName={system.name} />
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-3">
            <h3 className="text-label font-semibold text-text-primary">{systemsCopy.detail.assessmentsTitle}</h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ASSESSMENT_ATTRIBUTES.map((attribute) => (
                <li key={attribute} className="flex items-center justify-between gap-3 rounded-field border border-border-subtle px-3 py-2">
                  <span className="text-help text-text-secondary">{ASSESSMENT_ATTRIBUTE_LABELS[attribute]}</span>
                  <AssessmentBadge value={system.assessments[attribute].value} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

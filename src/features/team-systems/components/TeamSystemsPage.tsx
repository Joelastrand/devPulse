"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { TeamPageHeader } from "../../teams/components/TeamPageHeader";
import {
  createTeamSystem,
  fetchAssignableMembers,
  fetchTeamSystems,
  updateTeamSystem,
  type AssignableMemberOption,
  type TeamSystemMutationResult,
  type TeamSystemsReadResult,
} from "../client/team-systems-gateway";
import { systemsCopy } from "../copy";
import {
  DEFAULT_SYSTEM_FILTER,
  filterSystems,
  summarizeSystems,
  type SystemFilter,
  type SystemSummaryInput,
} from "../domain/team-system-summary";
import { ASSESSMENT_ATTRIBUTES } from "../domain/team-system";
import type { TeamSystemView } from "../server/list-team-systems";
import { QualityExplanation } from "./ExplanationDialog";
import { SystemFilters } from "./SystemFilters";
import { SystemForm } from "./SystemForm";
import { KnowledgeRiskPanel, QualityPanel, SystemSummaryCards } from "./SystemInsights";
import { SystemList } from "./SystemList";

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
      {state.phase === "loading" && <LoadingState label={systemsCopy.loading} />}
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

type FormState = { mode: "create" } | { mode: "edit"; system: TeamSystemView } | null;

function toSummaryInput(system: TeamSystemView): SystemSummaryInput {
  return {
    name: system.name,
    description: system.description,
    knowledgeRisk: system.knowledgeRisk,
    knowledgeCount: system.knowledge.length,
    attention: system.attention,
    inGoodStanding: ASSESSMENT_ATTRIBUTES.every((attribute) => system.assessments[attribute].value === "god"),
  };
}

function SystemsContent({ token, teamId }: { token: string; teamId: string }) {
  const [list, setList] = useState<ListState>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<SystemFilter>(DEFAULT_SYSTEM_FILTER);
  const [form, setForm] = useState<FormState>(null);
  const [saved, setSaved] = useState(false);

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
    return <LoadingState label={systemsCopy.loading} />;
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
      filter={filter}
      onFilterChange={setFilter}
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
  filter: SystemFilter;
  onFilterChange: (next: SystemFilter) => void;
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
  filter,
  onFilterChange,
  form,
  onOpenForm,
  saved,
  onSaved,
}: LoadedSystemsProps) {
  const summary = useMemo(() => summarizeSystems(systems.map(toSummaryInput)), [systems]);
  const visible = useMemo(() => filterSystems(systems, filter), [systems, filter]);
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

      {form !== null && (
        <EditorPanel token={token} teamId={teamId} form={form} onCancel={() => onOpenForm(null)} onSaved={onSaved} />
      )}

      <SystemSummaryCards summary={summary} />

      {hasAnySystem ? (
        <section aria-label="Systemliste" className="flex flex-col gap-4 rounded-surface border border-border-subtle bg-surface p-4 shadow-card md:p-6">
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <QualityExplanation />
            </div>
            <SystemFilters filter={filter} onChange={onFilterChange} />
          </div>
          {!hasAssessment && <p className="text-help text-text-muted">{systemsCopy.empty.noAssessmentsBody}</p>}
          {visible.length === 0 ? (
            <EmptyState>
              <span className="block font-medium text-text-primary">{systemsCopy.empty.noSearchResultsTitle}</span>
              {systemsCopy.empty.noSearchResultsBody}
            </EmptyState>
          ) : (
            <SystemList systems={visible} canEdit={canEdit} onEdit={(system) => onOpenForm({ mode: "edit", system })} />
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

/** Loads the knowledge selector options only when the form opens. */
function EditorPanel({
  token,
  teamId,
  form,
  onCancel,
  onSaved,
}: {
  token: string;
  teamId: string;
  form: NonNullable<FormState>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [members, setMembers] = useState<AssignableMemberOption[]>([]);
  const [membersStatus, setMembersStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetchAssignableMembers(token, teamId).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setMembers(result.members);
        setMembersStatus("ok");
      } else {
        setMembersStatus("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId]);

  async function submit(body: Record<string, unknown>): Promise<TeamSystemMutationResult> {
    if (form.mode === "create") {
      return createTeamSystem(token, teamId, body);
    }
    return updateTeamSystem(token, teamId, form.system.systemId, body);
  }

  return (
    <SystemForm
      key={form.mode === "edit" ? form.system.systemId : "create"}
      system={form.mode === "edit" ? form.system : null}
      members={members}
      membersStatus={membersStatus}
      onSubmit={submit}
      onDone={onSaved}
      onCancel={onCancel}
    />
  );
}

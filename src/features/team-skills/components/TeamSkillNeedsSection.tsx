"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { DeleteConfirmation, type DeleteActionState } from "../../forum/components/DeleteConfirmation";
import {
  deleteSkillNeed,
  fetchSkillCoverage,
  fetchSkillNeeds,
  putSkillNeed,
  type FetchSkillCoverageResult,
  type FetchSkillNeedsResult,
  type SkillCoverageRowView,
  type SkillNeedInput,
  type SkillNeedView,
  type SkillNeedWriteError,
} from "../client/team-skills-gateway";
import { needDescription, teamSkillsCopy } from "../copy";
import { SkillContributionPanel } from "./SkillContributionPanel";
import { NEED_AREA_FIELD_ID, NEED_LEVEL_FIELD_ID, SkillNeedEditor } from "./SkillNeedEditor";

const HEADING_ID = "team-skill-needs-heading";
const copy = teamSkillsCopy.needs;
const manage = teamSkillsCopy.manage;

type LoadedResult = Extract<FetchSkillNeedsResult, { status: "ok" }>;

/** The settled result is stored with the request it answers, so a token/team change never shows a stale one. */
interface Settled {
  requestKey: string;
  attempt: number;
  result: FetchSkillNeedsResult;
}

/**
 * «Kompetansebehov og dekning» on team Oversikt (docs/features/team-skill-needs-and-matrix/SPEC.md —
 * BR-26, BR-27, BR-28; TASK-008/009). It renders only the needs the server returns, one row per need and
 * nothing per person. The coverage column renders the categorical state the server returns from
 * `GET …/skill-coverage` (TASK-018), requested only when `viewer.canReadCoverage` is true; the browser
 * counts, thresholds and derives nothing and reads no roster or profile.
 * Management controls appear only when the server's `viewer.canManageNeeds` says so — a hint, not
 * authority: every write is re-authorized by the server. It also hosts the caller's own participation panel
 * (TASK-010), which is independent of need management and of this section's load state. Self-loading like `TeamRosterSection`; remount
 * with a new `key` when the auth generation changes.
 */
export function TeamSkillNeedsSection({ teamId, token, teamName }: { teamId: string; token: string; teamName?: string }) {
  const requestKey = `${teamId}\n${token}`;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const currentKeyRef = useRef(requestKey);

  useEffect(() => {
    currentKeyRef.current = requestKey;
  }, [requestKey]);

  useEffect(() => {
    let cancelled = false;
    void fetchSkillNeeds(token, teamId).then((result) => {
      if (!cancelled) setSettled({ requestKey, attempt, result });
    });
    return () => {
      cancelled = true;
    };
  }, [teamId, token, requestKey, attempt]);

  /**
   * Re-reads the server's truth after a write. A result for a team/token that is no longer current is
   * dropped, and a failed re-read keeps what is shown (reported as `false`) instead of replacing it.
   */
  const refresh = useCallback(async (): Promise<boolean> => {
    const result = await fetchSkillNeeds(token, teamId);
    if (currentKeyRef.current !== requestKey) return false;
    if (result.status !== "ok" && result.status !== "forbidden") return false;
    setSettled({ requestKey, attempt, result });
    return result.status === "ok";
  }, [token, teamId, requestKey, attempt]);

  const current = settled !== null && settled.requestKey === requestKey && settled.attempt === attempt ? settled.result : null;

  return (
    <Card as="section" aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h3 id={HEADING_ID} className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        {copy.heading}
      </h3>
      <p className="text-zinc-600 dark:text-zinc-400">{copy.intro}</p>
      <SkillContributionPanel key={`panel:${requestKey}`} teamId={teamId} token={token} teamName={teamName} />
      {current === null ? (
        <LoadingState label={copy.loading} />
      ) : current.status === "ok" ? (
        <NeedsManager key={`needs:${requestKey}`} teamId={teamId} token={token} result={current} onRefresh={refresh} />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{current.status === "forbidden" ? copy.forbidden : copy.error}</Alert>
          {current.status !== "forbidden" && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              {copy.retryButton}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

type Notice = { kind: "saved" | "deleted" } | null;
type DeleteTarget = { treeId: string; state: DeleteActionState } | null;

/** Errors after which the server's view of the team may differ from ours, so hints and rows are re-read. */
function mayHaveChangedServerSide(error: SkillNeedWriteError): boolean {
  return error === "forbidden" || error === "team_disabled" || error === "skill_unavailable" || error === "unknown";
}

/** The element a finished action hands focus to: the first or last rendered match (the table and card layouts both exist in the DOM). */
interface FocusRequest {
  selector: string;
  pick: "first" | "last";
  tick: number;
}

function focusRendered(root: HTMLElement | null, selector: string, pick: "first" | "last") {
  const all = Array.from(root?.querySelectorAll<HTMLElement>(selector) ?? []);
  const rendered = all.filter((element) => element.getClientRects().length > 0);
  const candidates = rendered.length > 0 ? rendered : all;
  (pick === "first" ? candidates[0] : candidates[candidates.length - 1])?.focus();
}

const byId = (id: string) => `#${id}`;
const inDelete = (treeId: string) => `[data-need-delete="${treeId.replace(/["\\]/g, "\\$&")}"] button`;

/**
 * Owns the one editor state, the pending flag and the delete confirmation for the loaded needs. It stays
 * mounted across refreshes (so notices survive them) and is remounted by `key` on a team/token change, so a
 * response for team A can never alter what is shown for team B.
 */
function NeedsManager({
  teamId,
  token,
  result,
  onRefresh,
}: {
  teamId: string;
  token: string;
  result: LoadedResult;
  onRefresh: () => Promise<boolean>;
}) {
  const { needs, catalog, catalogTruncated, needsTruncated, viewer } = result;
  const canManage = viewer.canManageNeeds;
  const root = useRef<HTMLDivElement>(null);
  const { coverage, retryCoverage } = useCoverage(teamId, token, result);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [editingTreeId, setEditingTreeId] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (focusRequest) focusRendered(root.current, focusRequest.selector, focusRequest.pick);
  }, [focusRequest]);

  const requestFocus = (selector: string, pick: "first" | "last" = "first") =>
    setFocusRequest((previous) => ({ selector, pick, tick: (previous?.tick ?? 0) + 1 }));

  const editing = canManage ? (needs.find((need) => need.treeId === editingTreeId && need.areaAvailable) ?? null) : null;
  const neededTreeIds = new Set(needs.map((need) => need.treeId));
  const selectableAreas = catalog.filter((entry) => !neededTreeIds.has(entry.treeId));

  /**
   * One write at a time; the server decides, the client only reconciles with what the server then says.
   * The write slot is taken first and `onStart` (the pending UI) runs only once the request really starts,
   * so a click that finds the slot busy changes nothing.
   */
  async function runWrite(
    write: () => Promise<{ ok: true } | { ok: false; error: SkillNeedWriteError }>,
    done: Notice,
    onStart: () => void,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    onStart();
    setBusy(true);
    setNotice(null);
    setError(null);
    const outcome = await write();
    if (!mounted.current) return;
    busyRef.current = false;
    setBusy(false);
    if (outcome.ok) {
      setNotice(done);
      setEditingTreeId(null);
      setFormVersion((version) => version + 1);
      requestFocus(byId(NEED_AREA_FIELD_ID));
    } else {
      setError(manage.errors[outcome.error]);
    }
    if (outcome.ok || mayHaveChangedServerSide(outcome.error)) {
      const refreshed = await onRefresh();
      if (mounted.current && !refreshed && outcome.ok) setError(manage.refreshFailed);
    }
  }

  function handleSubmit(treeId: string, input: SkillNeedInput) {
    // Saving closes any open delete confirmation: it cannot be confirmed while this write is in flight.
    void runWrite(() => putSkillNeed(token, teamId, treeId, input), { kind: "saved" }, () => setDeleteTarget(null));
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    const { treeId } = deleteTarget;
    void runWrite(
      async () => {
        const outcome = await deleteSkillNeed(token, teamId, treeId);
        if (mounted.current) setDeleteTarget(null);
        return outcome;
      },
      { kind: "deleted" },
      () => setDeleteTarget({ treeId, state: { status: "pending" } }),
    );
  }

  function startEdit(treeId: string) {
    setEditingTreeId(treeId);
    setDeleteTarget(null);
    setNotice(null);
    setError(null);
    requestFocus(byId(NEED_LEVEL_FIELD_ID));
  }

  function cancelEdit() {
    setEditingTreeId(null);
    setFormVersion((version) => version + 1);
    requestFocus(byId(NEED_AREA_FIELD_ID));
  }

  function requestDelete(treeId: string) {
    setDeleteTarget({ treeId, state: { status: "confirming" } });
    setEditingTreeId(null);
    setNotice(null);
    setError(null);
    requestFocus(inDelete(treeId), "last");
  }

  function cancelDelete(treeId: string) {
    setDeleteTarget(null);
    requestFocus(inDelete(treeId), "first");
  }

  const actions = canManage
    ? (need: SkillNeedView) => (
        <NeedActions
          need={need}
          busy={busy}
          deleteState={deleteTarget?.treeId === need.treeId ? deleteTarget.state : { status: "idle" }}
          deleteBlocked={busy || (deleteTarget !== null && deleteTarget.treeId !== need.treeId)}
          onEdit={() => startEdit(need.treeId)}
          onRequestDelete={() => requestDelete(need.treeId)}
          onCancelDelete={() => cancelDelete(need.treeId)}
          onConfirmDelete={handleConfirmDelete}
        />
      )
    : null;

  return (
    <div ref={root} className="flex flex-col gap-3">
      {needs.length === 0 ? (
        <div className="flex flex-col gap-1">
          <EmptyState>{copy.empty}</EmptyState>
          {!canManage && <p className="text-zinc-600 dark:text-zinc-400">{copy.emptyHint}</p>}
        </div>
      ) : (
        <>
          <NeedsTable needs={needs} coverage={coverage} actions={actions} />
          <NeedCards needs={needs} coverage={coverage} actions={actions} />
          {coverage.kind === "error" && (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p>{copy.coverageError}</p>
              <Button type="button" variant="secondary" size="sm" onClick={retryCoverage}>
                {copy.retryButton}
              </Button>
            </div>
          )}
        </>
      )}
      {needsTruncated && <Alert variant="info">{copy.truncated}</Alert>}
      {!canManage && <p className="text-sm text-zinc-600 dark:text-zinc-400">{copy.readOnly}</p>}

      <div role="status" className="text-sm text-zinc-700 dark:text-zinc-300">
        {notice ? (notice.kind === "saved" ? manage.saved : manage.deleted) : null}
      </div>
      {error && <Alert variant="error">{error}</Alert>}

      {canManage && (
        <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {editing === null && selectableAreas.length === 0 ? (
            <>
              <h4 className="text-base font-medium text-zinc-900 dark:text-zinc-50">{manage.addHeading}</h4>
              <EmptyState>{catalog.length === 0 ? manage.noAreasAtAll : manage.noAreasLeft}</EmptyState>
            </>
          ) : (
            <SkillNeedEditor
              key={`${editing?.treeId ?? "new"}:${formVersion}`}
              selectableAreas={selectableAreas}
              editing={editing}
              pending={busy && deleteTarget === null}
              locked={busy}
              onSubmit={handleSubmit}
              onCancelEdit={cancelEdit}
            />
          )}
          {catalogTruncated && <Alert variant="info">{manage.catalogTruncated}</Alert>}
        </div>
      )}
    </div>
  );
}

function NeedActions({
  need,
  busy,
  deleteState,
  deleteBlocked,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  need: SkillNeedView;
  busy: boolean;
  deleteState: DeleteActionState;
  deleteBlocked: boolean;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const area = areaCell(need);
  return (
    <div className="flex flex-col items-start gap-2">
      {need.areaAvailable && deleteState.status === "idle" && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          aria-label={manage.editAria(area)}
          onClick={onEdit}
        >
          {manage.editButton}
        </Button>
      )}
      <div data-need-delete={need.treeId}>
        <DeleteConfirmation
          state={deleteState}
          disabled={deleteBlocked}
          context={area}
          deleteLabel={manage.deleteButton}
          deletingLabel={manage.deleting}
          confirmPrompt={manage.deleteConfirmPrompt}
          confirmLabel={manage.deleteConfirmLabel}
          cancelLabel={manage.deleteCancelLabel}
          onRequestDelete={onRequestDelete}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={onConfirmDelete}
        />
      </div>
    </div>
  );
}

/** What the coverage column may show; one value for the whole table, derived from one server answer. */
type CoverageView =
  | { kind: "not_readable" }
  | { kind: "loading" }
  | { kind: "incomplete" }
  | { kind: "error" }
  | { kind: "members_only" }
  | { kind: "team_disabled" }
  | { kind: "rows"; rows: Map<string, SkillCoverageRowView> };

interface SettledCoverage {
  requestKey: string;
  forResult: LoadedResult;
  attempt: number;
  result: FetchSkillCoverageResult;
}

/**
 * Requests coverage only when the server's hint allows it, once per needs result (so a successful need write,
 * which re-reads the needs, also re-reads coverage). A coverage answer is kept with the team/token, needs
 * result and attempt it answers and is ignored otherwise, so a late or stale answer never shows.
 */
function useCoverage(teamId: string, token: string, result: LoadedResult) {
  const requestKey = `${teamId}
${token}`;
  const canRead = result.viewer.canReadCoverage;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<SettledCoverage | null>(null);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    void fetchSkillCoverage(token, teamId).then((answer) => {
      if (!cancelled) setSettled({ requestKey, forResult: result, attempt, result: answer });
    });
    return () => {
      cancelled = true;
    };
  }, [canRead, token, teamId, requestKey, result, attempt]);

  const retryCoverage = useCallback(() => setAttempt((n) => n + 1), []);

  let coverage: CoverageView;
  if (!canRead) coverage = { kind: "not_readable" };
  else if (settled === null || settled.requestKey !== requestKey || settled.forResult !== result || settled.attempt !== attempt) {
    coverage = { kind: "loading" };
  } else coverage = toCoverageView(settled.result);
  return { coverage, retryCoverage };
}

function toCoverageView(answer: FetchSkillCoverageResult): CoverageView {
  switch (answer.status) {
    case "available":
      return { kind: "rows", rows: new Map(answer.rows.map((row) => [row.treeId, row])) };
    case "incomplete":
      return { kind: "incomplete" };
    case "forbidden":
      return { kind: "members_only" };
    case "team_disabled":
      return { kind: "team_disabled" };
    default:
      return { kind: "error" };
  }
}

function areaCell(need: SkillNeedView): string {
  return need.areaAvailable && need.areaName !== null ? need.areaName : copy.unavailableAreaName;
}

function CoverageCell({ need, coverage }: { need: SkillNeedView; coverage: CoverageView }) {
  // A need whose area is gone reads the same everywhere (needs-read integrity state).
  if (!need.areaAvailable) return <>{copy.areaUnavailable}</>;
  switch (coverage.kind) {
    case "loading":
      return <>{copy.coverageLoading}</>;
    case "incomplete":
      return <>{copy.coverageIncomplete}</>;
    case "error":
      return <>{copy.coverageErrorCell}</>;
    case "members_only":
      return <>{copy.coverageMembersOnly}</>;
    case "team_disabled":
      return <>{copy.coverageDisabledTeam}</>;
    case "not_readable":
      // The hint cannot tell a non-member admin from a disabled team, so it states both facts.
      return <>{copy.coverageMembersOnly} {copy.coverageDisabledTeam}</>;
    case "rows": {
      const row = coverage.rows.get(need.treeId);
      // Joined by treeId only; a missing row or one for a different target is never shown as current.
      if (!row || row.requiredLevel !== need.requiredLevel || row.requiredCoverage !== need.requiredCoverage) {
        return <>{copy.coverageIncomplete}</>;
      }
      switch (row.state) {
        case "covered":
          return <>{copy.coverageCovered}</>;
        case "gap":
          return <>{copy.coverageGap}</>;
        case "area_unavailable":
          return <>{copy.areaUnavailable}</>;
        case "insufficient_data":
          return (
            <>
              {copy.coverageInsufficient}
              <span className="block text-sm text-zinc-600 dark:text-zinc-400">{copy.coverageInsufficientHint}</span>
            </>
          );
      }
    }
  }
}

type ActionsRenderer = ((need: SkillNeedView) => React.ReactNode) | null;

function NeedsTable({ needs, coverage, actions }: { needs: SkillNeedView[]; coverage: CoverageView; actions: ActionsRenderer }) {
  return (
    <table className="hidden w-full text-left sm:table">
      <caption className="sr-only">{copy.tableCaption}</caption>
      <thead>
        <tr className="border-b border-zinc-200 dark:border-zinc-800">
          <th scope="col" className="py-2 pr-4 font-medium">{copy.columnArea}</th>
          <th scope="col" className="py-2 pr-4 font-medium">{copy.columnNeed}</th>
          <th scope="col" className="py-2 pr-4 font-medium">{copy.columnCoverage}</th>
          {actions && <th scope="col" className="py-2 font-medium">{manage.actionsColumn}</th>}
        </tr>
      </thead>
      <tbody>
        {needs.map((need) => (
          <tr key={need.treeId} className="border-b border-zinc-100 align-top dark:border-zinc-900">
            <th scope="row" className="py-2 pr-4 font-normal break-words">{areaCell(need)}</th>
            <td className="py-2 pr-4">{needDescription(need.requiredCoverage, need.requiredLevel)}</td>
            <td className="py-2 pr-4"><CoverageCell need={need} coverage={coverage} /></td>
            {actions && <td className="py-2">{actions(need)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Below `sm` each need is a stacked card carrying the same text (and the same actions) as its table row. */
function NeedCards({ needs, coverage, actions }: { needs: SkillNeedView[]; coverage: CoverageView; actions: ActionsRenderer }) {
  return (
    <ul aria-label={copy.tableCaption} className="flex flex-col gap-2 sm:hidden">
      {needs.map((need) => (
        <Card as="li" key={need.treeId} padding="sm">
          <dl className="flex flex-col gap-1">
            <dt className="text-sm text-zinc-600 dark:text-zinc-400">{copy.columnArea}</dt>
            <dd className="break-words">{areaCell(need)}</dd>
            <dt className="text-sm text-zinc-600 dark:text-zinc-400">{copy.columnNeed}</dt>
            <dd>{needDescription(need.requiredCoverage, need.requiredLevel)}</dd>
            <dt className="text-sm text-zinc-600 dark:text-zinc-400">{copy.columnCoverage}</dt>
            <dd><CoverageCell need={need} coverage={coverage} /></dd>
            {actions && (
              <>
                <dt className="text-sm text-zinc-600 dark:text-zinc-400">{manage.actionsColumn}</dt>
                <dd>{actions(need)}</dd>
              </>
            )}
          </dl>
        </Card>
      ))}
    </ul>
  );
}

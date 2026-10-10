"use client";

import { useEffect, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { fetchSkillNeeds, type FetchSkillNeedsResult, type SkillNeedView } from "../client/team-skills-gateway";
import { needDescription, teamSkillsCopy } from "../copy";

const HEADING_ID = "team-skill-needs-heading";
const copy = teamSkillsCopy.needs;

type LoadedResult = Extract<FetchSkillNeedsResult, { status: "ok" }>;

/** The settled result is stored with the request it answers, so a token/team change never shows a stale one. */
interface Settled {
  requestKey: string;
  attempt: number;
  result: FetchSkillNeedsResult;
}

/**
 * «Kompetansebehov og dekning» on team Oversikt (docs/features/team-skill-needs-and-matrix/SPEC.md —
 * BR-26, BR-27, BR-28; TASK-008). Read-only: it renders only the needs the server returns, one row
 * per need and nothing per person. The coverage column is a fixed placeholder until the coverage
 * view exists; this component never calls the coverage endpoint and derives nothing from the roster
 * or from any profile. `viewer` hints only hide controls — the server re-authorizes every request.
 * Self-loading like `TeamRosterSection`; remount with a new `key` when the auth generation changes.
 */
export function TeamSkillNeedsSection({ teamId, token }: { teamId: string; token: string }) {
  const requestKey = `${teamId}\n${token}`;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSkillNeeds(token, teamId).then((result) => {
      if (!cancelled) setSettled({ requestKey, attempt, result });
    });
    return () => {
      cancelled = true;
    };
  }, [teamId, token, requestKey, attempt]);

  const current = settled !== null && settled.requestKey === requestKey && settled.attempt === attempt ? settled.result : null;

  return (
    <Card as="section" aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <h3 id={HEADING_ID} className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        {copy.heading}
      </h3>
      <p className="text-zinc-600 dark:text-zinc-400">{copy.intro}</p>
      {current === null ? (
        <LoadingState label={copy.loading} />
      ) : current.status === "ok" ? (
        <NeedsBody result={current} />
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

function NeedsBody({ result }: { result: LoadedResult }) {
  const { needs, needsTruncated, viewer } = result;
  return (
    <div className="flex flex-col gap-3">
      {needs.length === 0 ? (
        <div className="flex flex-col gap-1">
          <EmptyState>{copy.empty}</EmptyState>
          <p className="text-zinc-600 dark:text-zinc-400">{copy.emptyHint}</p>
        </div>
      ) : (
        <>
          <NeedsTable needs={needs} />
          <NeedCards needs={needs} />
        </>
      )}
      {needsTruncated && <Alert variant="info">{copy.truncated}</Alert>}
      {!viewer.canManageNeeds && <p className="text-sm text-zinc-600 dark:text-zinc-400">{copy.readOnly}</p>}
    </div>
  );
}

function areaCell(need: SkillNeedView): string {
  return need.areaAvailable && need.areaName !== null ? need.areaName : copy.unavailableAreaName;
}

function coverageCell(need: SkillNeedView): string {
  return need.areaAvailable ? copy.coverageNotAvailableYet : copy.areaUnavailable;
}

function NeedsTable({ needs }: { needs: SkillNeedView[] }) {
  return (
    <table className="hidden w-full text-left sm:table">
      <caption className="sr-only">{copy.tableCaption}</caption>
      <thead>
        <tr className="border-b border-zinc-200 dark:border-zinc-800">
          <th scope="col" className="py-2 pr-4 font-medium">{copy.columnArea}</th>
          <th scope="col" className="py-2 pr-4 font-medium">{copy.columnNeed}</th>
          <th scope="col" className="py-2 font-medium">{copy.columnCoverage}</th>
        </tr>
      </thead>
      <tbody>
        {needs.map((need) => (
          <tr key={need.treeId} className="border-b border-zinc-100 align-top dark:border-zinc-900">
            <th scope="row" className="py-2 pr-4 font-normal break-words">{areaCell(need)}</th>
            <td className="py-2 pr-4">{needDescription(need.requiredCoverage, need.requiredLevel)}</td>
            <td className="py-2">{coverageCell(need)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Below `sm` each need is a stacked card carrying the same text as its table row. */
function NeedCards({ needs }: { needs: SkillNeedView[] }) {
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
            <dd>{coverageCell(need)}</dd>
          </dl>
        </Card>
      ))}
    </ul>
  );
}

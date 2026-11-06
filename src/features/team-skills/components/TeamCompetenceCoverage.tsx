"use client";

import { useEffect, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { fetchSkillCoverage, type FetchSkillCoverageResult, type SkillCoverageState } from "../client/team-skills-gateway";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { SKILL_COVERAGE_MIN_CONTRIBUTORS } from "../domain/skill-coverage-policy";

/**
 * Teamkompetanse (TASK-011, SPEC BR-25–BR-27, SECURITY invariants 32–35). Renders only the categorical state of each
 * persisted team need from the existing coverage gateway. It shows no counts, averages, numeric scores, radar
 * coordinates or trends, and no individual data. The radar and trend panels stay disabled (SPEC D2).
 */

/** REQ labels for the categorical states the server returns. There is no backing state for a partial cover. */
const STATE_LABEL: Record<SkillCoverageState, string> = {
  covered: "Dekket",
  gap: "Behov for utvikling",
  insufficient_data: "Ikke nok grunnlag",
  area_unavailable: "Området kan ikke vises",
};

const STATE_EXPLANATION: Record<SkillCoverageState, string> = {
  covered: "Teamets behov for dette området er dekket.",
  gap: "Teamets behov for dette området er ikke dekket ennå.",
  insufficient_data: `Området vises først når minst ${SKILL_COVERAGE_MIN_CONTRIBUTORS} bidragsytere har vurdert det.`,
  area_unavailable: "Dette kompetanseområdet kan ikke vises akkurat nå.",
};

type AuthState = { phase: "loading" } | { phase: "signed_out" } | { phase: "signed_in"; token: string };
/** A result is tagged with the request it answers, so a response for an earlier team, token or attempt is never shown. */
type CoverageState = { requestKey: string; result: FetchSkillCoverageResult } | null;

export function TeamCompetenceCoverage({ teamId }: { teamId: string }) {
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });
  /** Bumped on every identity change and retry; the token itself never enters component state. */
  const [generation, setGeneration] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [coverage, setCoverage] = useState<CoverageState>(null);

  useAuthGatedResource((token) => {
    setGeneration((n) => n + 1);
    setAuth(token ? { phase: "signed_in", token } : { phase: "signed_out" });
  }, []);

  const token = auth.phase === "signed_in" ? auth.token : null;
  const requestKey = token === null ? null : `${teamId}|${generation}|${attempt}`;

  useEffect(() => {
    if (token === null || requestKey === null) return;
    let cancelled = false;
    void fetchSkillCoverage(token, teamId).then((result) => {
      if (!cancelled) setCoverage({ requestKey, result });
    });
    return () => {
      cancelled = true;
    };
  }, [token, teamId, requestKey]);

  const current = coverage !== null && coverage.requestKey === requestKey ? coverage.result : null;

  return (
    <section aria-labelledby="team-competence-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="team-competence-heading" className="text-lg font-semibold text-text-primary">
          Teamkompetanse
        </h2>
        <p className="text-sm text-text-secondary">
          Viser om teamets behov for hvert kompetanseområde er dekket. Enkeltpersoners vurderinger vises aldri. Et område vises
          først når minst {SKILL_COVERAGE_MIN_CONTRIBUTORS} bidragsytere har vurdert det.
        </p>
      </div>

      {auth.phase === "loading" || (token !== null && current === null) ? (
        <p className="text-text-secondary">Laster teamkompetansen…</p>
      ) : null}

      {auth.phase === "signed_out" ? <p className="text-text-secondary">Logg inn for å se teamkompetansen.</p> : null}

      {current !== null ? <CoverageBody result={current} onRetry={() => setAttempt((n) => n + 1)} /> : null}

      <DisabledPanels />
    </section>
  );
}

function CoverageBody({ result, onRetry }: { result: FetchSkillCoverageResult; onRetry: () => void }) {
  if (result.status === "available") {
    if (result.rows.length === 0) {
      return <p className="text-text-secondary">Teamet har ingen kompetansebehov ennå.</p>;
    }
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Dekning per kompetanseområde</caption>
          <thead>
            <tr className="border-b border-border-subtle">
              <th scope="col" className="py-2 pr-4 font-medium text-text-primary">
                Kompetanseområde
              </th>
              <th scope="col" className="py-2 pr-4 font-medium text-text-primary">
                Behov
              </th>
              <th scope="col" className="py-2 font-medium text-text-primary">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.treeId} className="border-b border-border-subtle align-top">
                <th scope="row" className="py-2 pr-4 font-medium text-text-primary">
                  {row.areaName ?? "Ukjent område"}
                </th>
                <td className="py-2 pr-4 text-text-secondary">nivå «{SELF_ASSESSED_LEVEL_COPY[row.requiredLevel].name}» eller høyere</td>
                <td className="py-2">
                  <span className="font-medium text-text-primary">{STATE_LABEL[row.state]}</span>
                  <span className="block text-text-secondary">{STATE_EXPLANATION[row.state]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (result.status === "incomplete") {
    return <Alert variant="info">Teamkompetansen kan ikke vises for dette teamet akkurat nå.</Alert>;
  }

  if (result.status === "unauthenticated" || result.status === "forbidden") {
    return <Alert variant="info">Teamkompetansen vises bare for teamets medlemmer.</Alert>;
  }

  if (result.status === "team_disabled") {
    return <Alert variant="info">Teamkompetansen vises ikke for deaktiverte team.</Alert>;
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="error">Teamkompetansen kunne ikke lastes akkurat nå.</Alert>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        Prøv igjen
      </Button>
    </div>
  );
}

function DisabledPanels() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DisabledPanel title="Radar">Radarvisningen er ikke tilgjengelig. Den viser ikke enkeltpersoner eller team-gjennomsnitt.</DisabledPanel>
      <DisabledPanel title="Utvikling over tid">Utvikling over tid vises ikke, fordi teamet ikke har en godkjent trend-visning.</DisabledPanel>
    </div>
  );
}

function DisabledPanel({ title, children }: { title: string; children: string }) {
  return (
    <div aria-disabled="true" className="rounded-lg border border-dashed border-border-strong p-4 text-sm text-text-secondary">
      <p className="font-medium text-text-primary">{title}</p>
      <p>{children}</p>
    </div>
  );
}


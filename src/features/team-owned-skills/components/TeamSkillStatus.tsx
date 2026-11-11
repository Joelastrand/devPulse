"use client";

import { useState } from "react";
import { useAuthGatedResource } from "../../auth/client/use-auth-gated-resource";
import { SELF_ASSESSED_LEVEL_COPY } from "../../skill-profiles/copy";
import { Alert } from "../../../components/ui/Alert";
import { LoadingState } from "../../../components/ui/LoadingState";
import { teamSkillsCopy } from "../copy";
import {
  fetchTeamSkillAggregate,
  type TeamOwnedSkillAggregateStatus,
} from "../client/team-skills-gateway";

const copy = teamSkillsCopy.teamStatus;

/**
 * Team-level status of the team's active skills (team-owned-skills SPEC §6). Every member sees the same aggregate; no
 * individual rating, count or contributor number is shown. Suppressed skills read "not enough data".
 */
export function TeamSkillStatus({ teamId }: { teamId: string }) {
  const [result, setResult] = useState<TeamOwnedSkillAggregateStatus | null>(null);

  useAuthGatedResource((token) => {
    setResult(null);
    if (token === null) {
      setResult({ status: "unauthenticated" });
      return;
    }
    void fetchTeamSkillAggregate(token, teamId).then(setResult);
  }, [teamId]);

  return (
    <section aria-labelledby="team-skill-status-heading" className="flex flex-col gap-2">
      <h3 id="team-skill-status-heading" className="text-base font-semibold text-text-primary">
        {copy.heading}
      </h3>
      <p className="text-sm text-text-secondary">{copy.description}</p>
      {result === null ? <LoadingState label={copy.loading} /> : <StatusBody result={result} />}
    </section>
  );
}

function StatusBody({ result }: { result: TeamOwnedSkillAggregateStatus }) {
  if (result.status !== "ok") {
    const message = result.status === "incomplete" ? copy.incomplete : copy[result.status];
    return <Alert variant="info">{message}</Alert>;
  }
  if (result.rows.length === 0) return <p className="text-sm text-text-secondary">{copy.empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {result.rows.map((row) => (
        <li key={row.skillId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
          <span className="text-sm font-medium text-text-primary">{row.name}</span>
          {row.state === "value" ? (
            <span className="text-sm text-text-primary">
              {copy.level(row.level, SELF_ASSESSED_LEVEL_COPY[row.level].name)}
            </span>
          ) : (
            <span className="text-sm text-text-secondary">{copy.insufficient}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Card } from "../../../components/ui/Card";
import { LoadingState } from "../../../components/ui/LoadingState";
import { fetchPublicTeam, type FetchPublicTeamResult } from "../client/team-visibility-gateway";
import { visibilityCopy } from "../visibility-copy";

type State = { phase: "loading" } | { phase: "done"; result: FetchPublicTeamResult };

/**
 * Anonymous public team page. It renders only the server's public projection (`{teamId, name}`); it never reads a token
 * and never fetches any member, competence, project or conversation data. A private or unknown team shows the same
 * neutral message.
 */
export function PublicTeamPage({ teamId }: { teamId: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let active = true;
    void fetchPublicTeam(teamId).then((result) => {
      if (active) setState({ phase: "done", result });
    });
    return () => {
      active = false;
    };
  }, [teamId]);

  return (
    <Card as="section" aria-labelledby="public-team-heading" className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">{visibilityCopy.publicHeading}</p>
      {state.phase === "loading" && <LoadingState label={visibilityCopy.loading} />}
      {state.phase === "done" && state.result.status === "ok" && (
        <h1 id="public-team-heading" className="text-2xl font-semibold text-text-primary">
          {state.result.team.name}
        </h1>
      )}
      {state.phase === "done" && state.result.status === "not_found" && (
        <Alert variant="info">{visibilityCopy.publicNotFound}</Alert>
      )}
      {state.phase === "done" && state.result.status === "read_failed" && (
        <Alert variant="error">{visibilityCopy.publicError}</Alert>
      )}
      <Link href="/sign-in" className="text-sm underline">
        {visibilityCopy.publicSignIn}
      </Link>
    </Card>
  );
}

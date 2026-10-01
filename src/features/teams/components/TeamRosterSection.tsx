"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadingState } from "../../../components/ui/LoadingState";
import { fetchTeamRoster, type FetchTeamRosterResult } from "../client/team-roster-gateway";
import { teamsCopy } from "../copy";

type RosterState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "loaded"; result: Extract<FetchTeamRosterResult, { status: "ok" }> }
  | { phase: "error"; status: "unauthenticated" | "forbidden" | "read_failed" };

const PANEL_ID = "team-roster-panel";
const HEADING_ID = "team-roster-heading";

/**
 * Collapsed, read-only team roster on `/teams/[teamId]` (docs/features/
 * member-identity-and-team-roles/SPEC.md — BR-31). Self-contained: it adds no
 * request to `TeamDetail`'s initial load and fetches **lazily on the first
 * expand** only (later collapse/expand reuses the loaded list; a retry
 * re-fetches after an error). Its own loading/error state means a roster
 * failure never affects any other section. It renders only what the roster
 * endpoint returns — `displayName`, `isLead`, `isSelf` — and makes no other
 * request (no Auth, admin, profile or per-person lookup). `isLead`/`isSelf`
 * are the server's answers, used for presentation only; rows are plain,
 * non-interactive text with no identifier, so the list key is purely local
 * (position plus shown name) — acceptable because the list is read-only, has
 * no per-row state and is never reordered client-side. Remount it with a new
 * `key` when the auth generation changes so nothing from a previous identity
 * survives.
 */
export function TeamRosterSection({ teamId, token }: { teamId: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RosterState>({ phase: "idle" });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function load() {
    setState({ phase: "loading" });
    const result = await fetchTeamRoster(token, teamId);
    if (!mountedRef.current) {
      return;
    }
    setState(result.status === "ok" ? { phase: "loaded", result } : { phase: "error", status: result.status });
  }

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && state.phase === "idle") {
      void load();
    }
  }

  return (
    <Card as="section" aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h3 id={HEADING_ID} className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          {teamsCopy.roster.title}
        </h3>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          aria-expanded={open}
          aria-controls={PANEL_ID}
          onClick={handleToggle}
        >
          {teamsCopy.roster.toggleButton}
          <span aria-hidden="true"> {open ? "▴" : "▾"}</span>
        </Button>
      </div>

      <div id={PANEL_ID} hidden={!open}>
        {open && <RosterBody state={state} onRetry={load} />}
      </div>
    </Card>
  );
}

function RosterBody({ state, onRetry }: { state: RosterState; onRetry: () => void }) {
  if (state.phase === "idle" || state.phase === "loading") {
    return <LoadingState label={teamsCopy.roster.loading} />;
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="error">
          {state.status === "forbidden" ? teamsCopy.roster.forbidden : teamsCopy.roster.error}
        </Alert>
        {state.status !== "forbidden" && (
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            {teamsCopy.roster.retryButton}
          </Button>
        )}
      </div>
    );
  }

  const { members, truncated } = state.result;

  if (members.length === 0) {
    return <EmptyState>{teamsCopy.roster.empty}</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={teamsCopy.roster.listLabel} className="flex flex-col gap-2">
        {members.map((member, index) => (
          <li
            key={`${index}-${member.displayName ?? ""}`}
            className="flex flex-wrap items-center gap-2 text-zinc-900 dark:text-zinc-50"
          >
            <span className="break-words">{member.displayName ?? teamsCopy.roster.unnamedMember}</span>
            {member.isLead && <Badge>{teamsCopy.roster.leadLabel}</Badge>}
            {member.isSelf && <Badge>{teamsCopy.roster.selfLabel}</Badge>}
          </li>
        ))}
      </ul>
      {truncated && <Alert variant="info">{teamsCopy.roster.truncated}</Alert>}
    </div>
  );
}

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Alert } from "../../../components/ui/Alert";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { cx } from "../../../components/ui/class-names";
import { teamsCopy } from "../copy";
import type { TeamOverviewEntry } from "../client/teams-overview-gateway";
import { TeamIdentity } from "./TeamIdentity";

const RELATIONSHIP_LABELS: Record<TeamOverviewEntry["relationship"], string> = teamsCopy.relationshipLabels;

export interface TeamCardRequestState {
  pending: boolean;
  /** A Norwegian, non-sensitive message from the request-access result; absent when there is no error. */
  errorMessage?: string;
}

/**
 * One team in a responsive grid. The team name is the only link, and its
 * stretched `::after` layer makes the whole card clickable without nesting
 * interactive elements. A card without access offers the request-access
 * action instead. The member count is not shown: the overview never carries
 * one, and fetching it would be an extra request made just for display.
 */
export function TeamCard({
  team,
  requestState = { pending: false },
  onRequestAccess,
}: {
  team: TeamOverviewEntry;
  requestState?: TeamCardRequestState;
  onRequestAccess: () => void;
}) {
  const canOpen = team.canOpen;
  const canRequestAccess =
    !canOpen && (team.relationship === "none" || team.relationship === "request_rejected");
  const showFooter = canOpen || canRequestAccess;

  return (
    <li
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-surface border border-border-subtle bg-surface shadow-card transition-colors duration-micro ease-standard",
        canOpen && "hover:border-primary has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-primary",
      )}
    >
      <TeamIdentity teamId={team.teamId} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 flex-col items-start gap-2">
          {canOpen ? (
            <Link
              href={`/teams/${encodeURIComponent(team.teamId)}`}
              className="break-words text-panel-title font-semibold text-text-primary underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
            >
              {team.name}
            </Link>
          ) : (
            <p className="break-words text-panel-title font-semibold text-text-primary">{team.name}</p>
          )}
          <Badge>{RELATIONSHIP_LABELS[team.relationship]}</Badge>
        </div>

        {requestState.errorMessage && (
          <Alert variant="error" className="text-sm">
            {requestState.errorMessage}
          </Alert>
        )}

        {showFooter && (
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
            {canOpen ? (
              <span
                aria-hidden="true"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors duration-micro ease-standard group-hover:underline"
              >
                {teamsCopy.overview.openTeam}
                <Icon icon={ArrowRight} size="inline" />
              </span>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                pending={requestState.pending}
                onClick={onRequestAccess}
              >
                {requestState.pending ? teamsCopy.requestingAccess : teamsCopy.requestAccess}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

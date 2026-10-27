import Link from "next/link";
import { Badge } from "../../../components/ui/Badge";
import { Card } from "../../../components/ui/Card";
import type { OwnerSummaryWire, ParticipationSummaryWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";

function conversationHref(conversationId: string): string {
  const id = encodeURIComponent(conversationId);
  return `/me/conversations/${id}`;
}

/** The owner's own summaries, in the server order. Recovery items are rendered by `RecoveryRegion`, not here. */
export function OwnedConversationList({ items }: { items: readonly OwnerSummaryWire[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((conversation) => (
        <Card as="li" key={conversation.conversationId} padding="sm" className="flex flex-col gap-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            {/* The owner detail page exists from TASK-028. Accepted participant titles stay plain text until TASK-030. */}
            <Link
              href={conversationHref(conversation.conversationId)}
              className="min-w-0 break-words font-medium text-zinc-900 underline dark:text-zinc-50"
            >
              {conversation.title}
            </Link>
            <Badge>{conversationsCopy.statusLabel[conversation.status]}</Badge>
          </div>
          {conversation.plannedFor !== null && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {conversationsCopy.plannedForLabel}: {conversation.plannedFor}
            </p>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {conversationsCopy.participantStateLabel[conversation.participant.state]}
            {conversation.participant.state !== "none" && (
              <> · {conversation.participant.displayName ?? conversationsCopy.anonymousColleague}</>
            )}
          </p>
        </Card>
      ))}
    </ul>
  );
}

/**
 * The caller's participations, in the server order. A pending entry has no title (BR-44), so it shows only the team
 * and the pending state. An accepted entry shows its title and team.
 */
export function ParticipationList({ items }: { items: readonly ParticipationSummaryWire[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((participation) => (
        <Card as="li" key={participation.conversationId} padding="sm" className="flex flex-col gap-1">
          {participation.state === "pending" ? (
            <>
              <div>
                <Badge>{conversationsCopy.pendingBadge}</Badge>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {conversationsCopy.teamLabel}: {participation.teamName}
              </p>
              <Link
                href={conversationHref(participation.conversationId)}
                aria-label={conversationsCopy.openPendingName(participation.teamName)}
                className="mt-1 text-sm font-medium text-zinc-900 underline dark:text-zinc-50"
              >
                {conversationsCopy.openPendingLink}
              </Link>
            </>
          ) : (
            <>
              <Link
                href={conversationHref(participation.conversationId)}
                className="min-w-0 break-words font-medium text-zinc-900 underline dark:text-zinc-50"
              >
                {participation.title ?? conversationsCopy.titleUnavailable}
              </Link>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {conversationsCopy.teamLabel}: {participation.teamName}
              </p>
            </>
          )}
        </Card>
      ))}
    </ul>
  );
}

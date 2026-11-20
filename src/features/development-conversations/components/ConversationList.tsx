import type { ReactNode } from "react";
import Link from "next/link";
import { StatusBadge, type StatusTone } from "../../../components/ui/StatusBadge";
import type { OwnerSummaryWire, ParticipationSummaryWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";

function conversationHref(conversationId: string): string {
  const id = encodeURIComponent(conversationId);
  return `/me/conversations/${id}`;
}

/**
 * The owner's participant indicator for one row, from the authorized state and display name the list already carries. The
 * name is never invented: without one, the neutral colleague label is used. A pending invitation is described as an
 * invitation, never as a shared conversation.
 */
function ownerParticipantIndicator(state: OwnerSummaryWire["participant"]["state"], displayName: string | null): string {
  const name = displayName ?? conversationsCopy.anonymousColleague;
  switch (state) {
    case "none":
      return conversationsCopy.participantIndicatorNone;
    case "pending":
      return conversationsCopy.participantIndicatorInvited(name);
    case "accepted":
      return conversationsCopy.participantIndicatorShared(name);
    case "unavailable":
      return conversationsCopy.participantIndicatorUnavailable(name);
  }
}

const OWNER_STATUS_TONE: Record<OwnerSummaryWire["status"], StatusTone> = {
  open: "neutral",
  completed: "success",
};

/**
 * One row of the list. The whole row is a single link: the title link is stretched over the row with a pseudo-element, so
 * there is one tab stop per row and no nested interactive control. Status is text with a tone, never colour alone. Date and
 * people sit beneath the title on narrow screens and beside it on wide ones.
 */
function ListRow({
  href,
  title,
  badges,
  meta,
  context,
}: {
  href: string;
  title: string;
  badges: ReactNode;
  meta: ReactNode;
  context?: string;
}) {
  return (
    <li className="relative flex min-w-0 flex-col gap-2 px-4 py-3 hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        {context !== undefined && <p className="text-eyebrow text-text-muted">{context}</p>}
        <Link
          href={href}
          className="min-w-0 break-words text-body font-semibold text-text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 after:absolute after:inset-0 after:content-['']"
        >
          {title}
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-help text-text-secondary">{meta}</div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{badges}</div>
    </li>
  );
}

/**
 * The owner's own summaries, in the server order. Each row opens its own detail page; the list has no selection state.
 * Recovery items are rendered by `RecoveryRegion`, not here.
 */
export function OwnedConversationList({ items }: { items: readonly OwnerSummaryWire[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-surface border border-border-subtle bg-surface">
      {items.map((conversation) => {
        const { participant } = conversation;
        return (
          <ListRow
            key={conversation.conversationId}
            href={conversationHref(conversation.conversationId)}
            title={conversation.title}
            badges={<StatusBadge tone={OWNER_STATUS_TONE[conversation.status]}>{conversationsCopy.statusLabel[conversation.status]}</StatusBadge>}
            meta={
              <>
                {/* A quiet participant indicator: the state and the name, as text, never as a colour-only badge. */}
                <span className="min-w-0 break-words">{ownerParticipantIndicator(participant.state, participant.displayName)}</span>
                {conversation.plannedFor !== null && (
                  <span>
                    {conversationsCopy.plannedForLabel}: {conversation.plannedFor}
                  </span>
                )}
              </>
            }
          />
        );
      })}
    </ul>
  );
}

/**
 * The caller's participations, in the server order. A pending entry has no title (BR-44), so it shows an invitation label
 * and the pending state. An accepted entry shows its title.
 */
export function ParticipationList({ items }: { items: readonly ParticipationSummaryWire[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-surface border border-border-subtle bg-surface">
      {items.map((participation) =>
        participation.state === "pending" ? (
          <ListRow
            key={participation.conversationId}
            href={conversationHref(participation.conversationId)}
            title={conversationsCopy.pendingRowTitle}
            context={conversationsCopy.invitedToMe}
            badges={<StatusBadge tone="info">{conversationsCopy.pendingBadge}</StatusBadge>}
            meta={null}
          />
        ) : (
          <ListRow
            key={participation.conversationId}
            href={conversationHref(participation.conversationId)}
            title={participation.title ?? conversationsCopy.titleUnavailable}
            context={conversationsCopy.participatingInByMe}
            badges={null}
            /* The owner's name is not in this list's read model, so it is not shown; see the report. */
            meta={<span>{conversationsCopy.participantIndicatorWithOwnerUnnamed}</span>}
          />
        ),
      )}
    </ul>
  );
}

import type { SharedEvidenceWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { Card } from "../../../components/ui/Card";

/**
 * Read-only list of evidence snapshots (SPEC BR-43, Amendment C2). Renders only the allow-listed fields of each snapshot.
 * Kind, relation and status are text, so no state is shown by colour alone. Source ids never reach this component.
 */
export function SharedEvidenceList({ items, headingId }: { items: SharedEvidenceWire[]; headingId: string }) {
  if (items.length === 0) {
    return <p className="text-text-muted">{conversationsCopy.noSharedEvidence}</p>;
  }
  return (
    <ul aria-labelledby={headingId} className="flex flex-col gap-2">
      {items.map((item, index) => (
        <Card as="li" key={index} padding="sm" className="flex flex-col gap-1">
          <p className="text-sm text-text-muted">{conversationsCopy.evidenceKindLabel[item.kind]}</p>
          <p className="min-w-0 break-words font-medium text-text-primary">{item.title}</p>
          {item.description !== null && <p className="min-w-0 break-words text-sm text-text-secondary">{item.description}</p>}
          {item.kind === "achievement" && item.outcome !== null && (
            <p className="min-w-0 break-words text-sm text-text-secondary">
              {conversationsCopy.evidenceOutcomeLabel}: {item.outcome}
            </p>
          )}
          <p className="text-sm text-text-muted">{conversationsCopy.evidenceRelationLabel[item.relationToRole]}</p>
          <PeriodLine start={item.period.start} end={item.period.end} />
          {item.kind === "responsibility" && (
            <p className="text-sm text-text-muted">{conversationsCopy.goalStatusLabel[item.status]}</p>
          )}
        </Card>
      ))}
    </ul>
  );
}

function PeriodLine({ start, end }: { start: string | null; end: string | null }) {
  if (start === null && end === null) return null;
  return (
    <p className="text-sm text-text-muted">
      {conversationsCopy.evidencePeriodLabel}: {start ?? "…"} – {end ?? "…"}
    </p>
  );
}

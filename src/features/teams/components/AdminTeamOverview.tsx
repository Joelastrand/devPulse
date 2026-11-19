import { adminCopy } from "../copy";

/**
 * Overview panel (`Oversikt`) for the team administration page. Counts are taken from data the page has already loaded;
 * no extra request is made. The challenge count is omitted when that section did not load, rather than shown as zero.
 * Section navigation is provided only by the main tab bar, so this panel contains summaries and no shortcut links.
 */
export interface AdminTeamOverviewCounts {
  members: number;
  invitations: number;
  requests: number;
  surveys: number;
  challenges: number | null;
}

export function AdminTeamOverview({ counts }: { counts: AdminTeamOverviewCounts }) {
  const copy = adminCopy.detail.overview;
  const summary: Array<{ key: string; label: string; value: number }> = [
    { key: "members", label: copy.members, value: counts.members },
    { key: "invitations", label: copy.invitations, value: counts.invitations },
    { key: "requests", label: copy.requests, value: counts.requests },
    { key: "surveys", label: copy.surveys, value: counts.surveys },
  ];
  if (counts.challenges !== null) {
    summary.push({ key: "challenges", label: copy.challenges, value: counts.challenges });
  }

  return (
    <section aria-labelledby="admin-team-overview-summary" className="flex flex-col gap-3">
      <h2 id="admin-team-overview-summary" className="text-lg font-semibold text-text-primary">
        {copy.summaryLabel}
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {summary.map((item) => (
          <div key={item.key} className="rounded-md border border-border-subtle bg-surface-elevated p-3">
            <dt className="text-sm text-text-secondary">{item.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

import type { ComparisonRowView, ComparisonView } from "../client/role-target-gateway";
import { CreateGoalAction } from "./CreateGoalAction";
import { personRoleCopy } from "../copy";

const copy = personRoleCopy.comparison;

const STATUS_LABELS: Record<ComparisonRowView["status"], string> = {
  meets: copy.meets,
  development_opportunity: copy.developmentOpportunity,
  not_assessed: copy.notAssessed,
  area_unavailable: copy.unavailable,
};

/**
 * The owner's comparison rows under the target (PG-4, BR-11, BR-12). One text label per status, in the response order, with
 * no totals, counts, percentages or sorting. A missing own level reads as "not assessed yet", never as zero. Rendered only
 * on the owner's own page; the privacy notice is shown with the rows.
 */
export function ComparisonRows({ comparison }: { comparison: ComparisonView }) {
  if (comparison.state === "no_target") {
    return null;
  }

  if (comparison.state === "target_unavailable") {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {comparison.reason === "no_expectations" ? personRoleCopy.noExpectations : personRoleCopy.unavailable}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {comparison.rows.map((row) => (
          <li key={row.treeId} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="font-medium text-zinc-900 dark:text-zinc-50">{row.treeName ?? copy.areaUnavailable}</p>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{STATUS_LABELS[row.status]}</p>
            {(row.status === "development_opportunity" || row.status === "not_assessed") && (
              <div className="mt-2">
                <CreateGoalAction treeId={row.treeId} />
              </div>
            )}
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {copy.expectedLevel(row.expectedLevel)}
              {" · "}
              {row.ownLevel !== null
                ? copy.ownLevel(row.ownLevel)
                : row.status === "area_unavailable"
                  ? copy.unavailable
                  : copy.notAssessed}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{copy.privacyNotice}</p>
    </div>
  );
}

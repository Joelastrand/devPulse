import Link from "next/link";
import { personRoleCopy } from "../copy";

/**
 * The "Opprett mål" entry for one comparison row (PG-1, PG-11, BR-14 to BR-16). It is a plain link to the D1 goals page
 * with `treeId` as the only parameter: no title, no role, no level. Rendering or following it creates nothing; the goal
 * is created only by the explicit submit of the D1 form.
 */
export function CreateGoalAction({ treeId }: { treeId: string }) {
  return (
    <Link
      href={`/me/goals?treeId=${encodeURIComponent(treeId)}`}
      className="inline-flex items-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-800"
    >
      {personRoleCopy.comparison.createGoal}
    </Link>
  );
}

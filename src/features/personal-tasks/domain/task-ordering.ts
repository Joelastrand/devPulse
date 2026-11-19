import { compareTasks } from "./task";

/** Anything with an id and a fractional position: a stored task, or a board DTO. */
export interface Positioned {
  id: string;
  position: number;
}

/** Gap used when appending or prepending, so a later insert between neighbours has room. */
export const POSITION_STEP = 1024;

export type PlacementResult<T extends Positioned> =
  | { ok: true; tasks: T[] }
  | { ok: false; error: "invalid_position" };

/**
 * Places `moved` into `column` (the other tasks of the target status, excluding `moved`) in front of `beforeTaskId`, or at
 * the end when `beforeTaskId` is `null`. Returns the column with `moved` at its new position, and only the tasks whose
 * position changed (the moved task always, plus renumbered neighbours when a rebalance was needed). `beforeTaskId` must
 * name a task in the column; otherwise nothing is placed.
 *
 * Fractional positions are midpoints. When two neighbours are too close for a strictly-between value (float precision),
 * the whole column is renumbered to multiples of `POSITION_STEP` in order, which keeps the operation bounded.
 */
export function placeTask<T extends Positioned>(
  moved: T,
  column: readonly T[],
  beforeTaskId: string | null,
): PlacementResult<T> {
  const ordered = [...column].sort(compareTasks);
  let index: number;
  if (beforeTaskId === null) {
    index = ordered.length;
  } else {
    index = ordered.findIndex((task) => task.id === beforeTaskId);
    if (index === -1) return { ok: false, error: "invalid_position" };
  }

  const prev = index > 0 ? ordered[index - 1].position : undefined;
  const next = index < ordered.length ? ordered[index].position : undefined;
  let position: number;
  if (prev === undefined && next === undefined) position = 0;
  else if (prev === undefined) position = (next as number) - POSITION_STEP;
  else if (next === undefined) position = prev + POSITION_STEP;
  else position = (prev + next) / 2;

  const fits = (prev === undefined || position > prev) && (next === undefined || position < next);
  if (!fits) {
    const withMoved = [...ordered.slice(0, index), { ...moved }, ...ordered.slice(index)];
    const renumbered = withMoved.map((task, i) => ({ ...task, position: i * POSITION_STEP }));
    return { ok: true, tasks: renumbered };
  }
  return { ok: true, tasks: [{ ...moved, position }] };
}

import type { SkillTreeNodeView } from "../client/skill-trees-gateway";
import { skillProgressPathCopy } from "../copy";

/**
 * Positional stage state, relative to the team's *current* step only
 * (docs/features/gamified-skill-tree/SPEC.md — BR-1). Never stored and never
 * a claim of completion: `earlier` means "before the current step".
 */
export type StageState = "earlier" | "current" | "upcoming";

export interface DerivedStage {
  node: SkillTreeNodeView;
  state: StageState;
}

export interface DerivedSkillProgressPath {
  /** Sorted copy by `order` ascending; the caller's array is never mutated (BR-4). */
  stages: DerivedStage[];
  /** Index of the current stage in `stages`, or `null` when there is none (`null` or unmatched id). */
  currentIndex: number | null;
}

/**
 * Derives every stage's state purely from `nodes` and `currentNodeId`
 * (BR-1..BR-3). `null` (tracked, not started) and a non-null id matching no
 * node (defensive fallback) both yield all-`upcoming` stages with no current
 * stage; the component distinguishes them via `currentNodeId` (BR-2).
 */
export function deriveSkillProgressPath(
  nodes: readonly SkillTreeNodeView[],
  currentNodeId: string | null,
): DerivedSkillProgressPath {
  const sorted = nodes.slice().sort((a, b) => a.order - b.order);
  const found = currentNodeId === null ? -1 : sorted.findIndex((node) => node.nodeId === currentNodeId);
  const currentIndex = found === -1 ? null : found;

  const stages = sorted.map((node, index): DerivedStage => {
    if (currentIndex === null || index > currentIndex) return { node, state: "upcoming" };
    return { node, state: index === currentIndex ? "current" : "earlier" };
  });

  return { stages, currentIndex };
}

const MARKER_CLASSES: Record<StageState, string> = {
  earlier: "border-zinc-500 bg-zinc-500 text-white dark:border-zinc-400 dark:bg-zinc-400 dark:text-zinc-900",
  current:
    "border-zinc-900 bg-zinc-900 text-white ring-2 ring-zinc-900/30 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 dark:ring-zinc-50/30",
  upcoming: "border-zinc-300 bg-transparent text-zinc-600 dark:border-zinc-600 dark:text-zinc-400",
};

/**
 * Presentational vertical progression path for one SkillTree and the team's
 * current step (SPEC BR-5, BR-6, BR-13..BR-17). Vertical at every width; no
 * fetch, state, effects, interactivity or motion. `name` only names the list.
 */
export function SkillProgressPath({
  name,
  nodes,
  currentNodeId,
}: {
  name: string;
  nodes: readonly SkillTreeNodeView[];
  currentNodeId: string | null;
}) {
  const { stages, currentIndex } = deriveSkillProgressPath(nodes, currentNodeId);

  let summary: string | null = null;
  if (currentNodeId === null) {
    summary = skillProgressPathCopy.notStarted;
  } else if (currentIndex !== null) {
    summary = skillProgressPathCopy.summaryPosition(stages[currentIndex].node.label, currentIndex + 1, stages.length);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {summary !== null && (
        <p className="break-words text-sm text-zinc-700 dark:text-zinc-300">
          {skillProgressPathCopy.summaryLabel}: <span className="font-medium">{summary}</span>
        </p>
      )}
      <ol role="list" aria-label={name} className="m-0 flex min-w-0 list-none flex-col p-0">
        {stages.map(({ node, state }, index) => {
          const isLast = index === stages.length - 1;
          const railSolid = currentIndex !== null && index < currentIndex;
          return (
            <li
              key={node.nodeId}
              aria-current={state === "current" ? "step" : undefined}
              className="relative flex min-w-0 gap-3 pb-4 last:pb-0"
            >
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-0 left-3 top-7 w-0 -translate-x-1/2 border-l-2 ${
                    railSolid
                      ? "border-solid border-zinc-500 dark:border-zinc-400"
                      : "border-dashed border-zinc-300 dark:border-zinc-600"
                  }`}
                />
              )}
              <span
                aria-hidden="true"
                className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-medium ${MARKER_CLASSES[state]}`}
              >
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={`break-words text-sm ${
                    state === "current"
                      ? "font-semibold text-zinc-900 dark:text-zinc-50"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {node.label}
                </span>
                <span className="text-xs text-zinc-600 dark:text-zinc-400">{skillProgressPathCopy.state[state]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

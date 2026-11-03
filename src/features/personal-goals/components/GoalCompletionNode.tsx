import { cx } from "../../../components/ui/class-names";

/**
 * The completion node on a goal card (docs/features/product-experience/SPEC.md —
 * Progress and gamification). It fills when the goal is completed, over the
 * 300 ms progress duration. The reduced-motion rule in app/globals.css disables
 * the change. It is decorative: the "Fullført" / "Aktivt" status text is the
 * meaning. It holds no percentage and no score.
 */
export function GoalCompletionNode({ completed }: { completed: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-4 shrink-0 rounded-full border-2 transition-colors duration-progress ease-standard",
        completed ? "border-success-text bg-success-text" : "border-border-strong bg-surface",
      )}
    />
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import { CollapsibleSection } from "../../../components/ui/CollapsibleSection";
import { SelectorOptionsSkeleton } from "./ConversationSkeletons";
import { fetchOwnGoals, type OwnGoalWire, type SharedGoalWire } from "../client/conversations-gateway";
import { conversationsCopy } from "../copy";
import { SHARED_GOALS_MAX } from "../domain/conversation-constants";
import { useOwnerWrite } from "./use-owner-write";
import { WriteFeedbackRegion } from "./WriteFeedbackRegion";

/** The owner's D1 goals for choosing snapshots. Loaded only while the conversation is open (BR-27). */
type GoalOptions = { phase: "loading" } | { phase: "ready"; goals: OwnGoalWire[]; truncated: boolean } | { phase: "unavailable" };

interface GoalSnapshotSelectorProps {
  conversationId: string;
  token: string;
  completed: boolean;
  sharedGoals: SharedGoalWire[];
  /** Must be stable: the goal list effect depends on it. */
  onUnauthenticated: () => void;
  onChanged: () => Promise<void>;
}

/**
 * The shared goal section (SPEC BR-24 to BR-27, BR-38; TASK-028). Snapshots are copies of goals taken now, and a save
 * replaces the whole set. Stored goal ids are never returned, so the current set is shown as text and the checkboxes start
 * empty. After completion the only action is clearing the set.
 */
export function GoalSnapshotSelector({ conversationId, token, completed, sharedGoals, onUnauthenticated, onChanged }: GoalSnapshotSelectorProps) {
  const { pending, feedback, feedbackRef, write } = useOwnerWrite({ token, conversationId, onUnauthenticated, onChanged });
  const [options, setOptions] = useState<GoalOptions>({ phase: "loading" });
  const [selected, setSelected] = useState<string[]>([]);
  /** The person opened the picker. A load failure also opens it, so the error is never hidden in a collapsed section. */
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (completed) return;
    let current = true;
    void fetchOwnGoals(token).then((result) => {
      if (!current) return;
      if (result.status === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      setOptions(
        result.status === "ok"
          ? { phase: "ready", goals: result.response.goals, truncated: result.response.truncated }
          : { phase: "unavailable" },
      );
    });
    return () => {
      current = false;
    };
  }, [token, completed, onUnauthenticated]);

  function toggle(goalId: string) {
    setSelected((previous) => {
      if (previous.includes(goalId)) return previous.filter((id) => id !== goalId);
      return previous.length < SHARED_GOALS_MAX ? [...previous, goalId] : previous;
    });
  }

  return (
    <section aria-labelledby="shared-goals-heading" className="flex flex-col gap-4">
      <h2 id="shared-goals-heading" className="text-lg font-semibold text-text-primary">
        {conversationsCopy.sharedGoalsSection}
      </h2>
      <p className="text-sm text-text-secondary">{conversationsCopy.sharedGoalsVisibility}</p>

      {sharedGoals.length === 0 ? (
        <p className="text-text-muted">{conversationsCopy.noSharedGoals}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-surface border border-border-subtle bg-surface">
          {sharedGoals.map((goal, index) => (
            <li key={index} className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
              <p className="min-w-0 break-words font-medium text-text-primary">{goal.goalTitle}</p>
              <p className="text-sm text-text-muted">{goal.areaName ?? conversationsCopy.areaUnavailable}</p>
              <p className="text-sm text-text-muted">
                {conversationsCopy.goalStatusLabel[goal.status]}
                {goal.targetDate !== null && (
                  <>
                    {" · "}
                    {conversationsCopy.goalDateLabel}: {goal.targetDate}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {completed ? (
        sharedGoals.length > 0 && (
          <div className="flex flex-col gap-3">
            <div>
              <Button
                type="button"
                variant="secondary"
                pending={pending}
                onClick={() => void write({ sharedGoalIds: [] }, conversationsCopy.goalsCleared)}
              >
                {pending ? conversationsCopy.saving : conversationsCopy.clearGoals}
              </Button>
            </div>
            <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
          </div>
        )
      ) : (
        <CollapsibleSection
          id="goal-picker"
          title={conversationsCopy.selectorHeading}
          description={conversationsCopy.goalSource}
          actions={
            <Link href="/me/goals" className="inline-flex min-h-11 items-center text-sm font-medium text-text-primary underline underline-offset-2">
              {conversationsCopy.goalSourceLink}
            </Link>
          }
          headingLevel={3}
          open={pickerOpen || options.phase === "unavailable"}
          onOpenChange={setPickerOpen}
          lockOpen={selected.length > 0}
          summary={conversationsCopy.selectedCount(selected.length)}
        >
        <div className="flex flex-col gap-3">


          {options.phase === "loading" && <SelectorOptionsSkeleton label={conversationsCopy.selectorLoading} />}
          {options.phase === "unavailable" && <Alert variant="error">{conversationsCopy.selectorError}</Alert>}
          {options.phase === "ready" && options.goals.length === 0 && (
            <p className="text-text-muted">
              {conversationsCopy.noGoalsToShare} <Link href="/me/goals" className="underline underline-offset-2">{conversationsCopy.createGoalLink}</Link>
            </p>
          )}
          {options.phase === "ready" && options.goals.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{conversationsCopy.selectorHeading}</legend>
              {options.goals.map((goal) => {
                const checked = selected.includes(goal.id);
                const atLimit = !checked && selected.length >= SHARED_GOALS_MAX;
                return (
                  <label key={goal.id} className="flex items-start gap-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={atLimit || pending}
                      onChange={() => toggle(goal.id)}
                      className="mt-1"
                    />
                    <span className="min-w-0 break-words">
                      {goal.title}{" "}
                      <span className="text-text-muted">({conversationsCopy.goalStatusLabel[goal.status]})</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {options.phase === "ready" && options.truncated && <Alert variant="info">{conversationsCopy.selectorTruncated}</Alert>}
          <p className="text-sm text-text-muted">{conversationsCopy.selectorLimit}</p>

          {/* An empty selection is never saved: that would clear every current snapshot. Clearing has its own action. */}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              pending={pending}
              disabled={options.phase !== "ready" || selected.length === 0}
              onClick={() => void write({ sharedGoalIds: selected }, conversationsCopy.goalsSaved)}
            >
              {pending ? conversationsCopy.saving : conversationsCopy.saveGoals}
            </Button>
          </div>
          {sharedGoals.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
              <p className="text-sm text-text-muted">{conversationsCopy.clearGoalsCopy}</p>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  pending={pending}
                  onClick={() => void write({ sharedGoalIds: [] }, conversationsCopy.goalsCleared)}
                >
                  {pending ? conversationsCopy.saving : conversationsCopy.clearGoals}
                </Button>
              </div>
            </div>
          )}
          <WriteFeedbackRegion feedback={feedback} regionRef={feedbackRef} />
        </div>
        </CollapsibleSection>
      )}
    </section>
  );
}

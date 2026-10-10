"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/ui/Alert";
import { Button } from "../../../components/ui/Button";
import {
  fetchSkillContribution,
  optInSkillContribution,
  withdrawSkillContribution,
  type FetchSkillContributionResult,
  type SkillContributionWriteError,
  type SkillContributionWriteResult,
} from "../client/team-skills-gateway";
import { participationCopy as copy } from "../copy";
import { SKILL_CONTRIBUTION_NOTICE_VERSION } from "../domain/skill-coverage-policy";

type View =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "error" }
  | { kind: "ready"; contributing: boolean; canOptIn: boolean };

type Message = { kind: "info" | "error"; text: string } | null;

const HEADING_ID = "skill-contribution-heading";

/** After these the server's view may differ from ours, so the state is re-read rather than guessed. */
function shouldReread(error: SkillContributionWriteError): boolean {
  return error !== "persistence_failed";
}

function toView(result: FetchSkillContributionResult): View {
  if (result.status === "ok") return { kind: "ready", contributing: result.contributing, canOptIn: result.canOptIn };
  // A non-member (an app admin included) has no participation to show or manage.
  return result.status === "forbidden" ? { kind: "hidden" } : { kind: "error" };
}

/**
 * The caller's own participation in one team's skill overview (SPEC BR-25, BR-9; TASK-010). It reads
 * and changes only the caller's own state through the participation endpoint, whose `canOptIn` — not
 * the need-management hint — decides whether the opt-in control exists. Remount with a new `key`
 * when the team or token changes: a response for another team/token then cannot touch this instance.
 * After every change the state is re-read from the server instead of being invented here.
 */
export function SkillContributionPanel({ teamId, token, teamName }: { teamId: string; token: string; teamName?: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState<"opt-in" | "withdraw" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    void fetchSkillContribution(token, teamId).then((result) => {
      if (mounted.current) setView(toView(result));
    });
  }, [teamId, token, attempt]);

  async function change(action: "opt-in" | "withdraw") {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(action);
    setMessage(null);
    const outcome: SkillContributionWriteResult =
      action === "opt-in"
        ? await optInSkillContribution(token, teamId, SKILL_CONTRIBUTION_NOTICE_VERSION)
        : await withdrawSkillContribution(token, teamId);
    if (!mounted.current) return;
    if (!outcome.ok && !shouldReread(outcome.error)) {
      setMessage({ kind: "error", text: copy.errors[outcome.error] });
      busyRef.current = false;
      setPending(null);
      return;
    }
    const reread = await fetchSkillContribution(token, teamId);
    if (!mounted.current) return;
    busyRef.current = false;
    setPending(null);
    setView(toView(reread));
    if (outcome.ok) {
      if (reread.status === "ok") setMessage({ kind: "info", text: action === "opt-in" ? copy.optedIn : copy.withdrawn });
    } else {
      setMessage({ kind: "error", text: copy.errors[outcome.error] });
    }
  }

  if (view.kind === "hidden") return null;

  const name = teamName && teamName.length > 0 ? teamName : copy.fallbackTeamName;

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h4 id={HEADING_ID} className="text-base font-medium text-zinc-900 dark:text-zinc-50">
        {copy.heading(name)}
      </h4>
      {view.kind === "loading" && <p className="text-zinc-600 dark:text-zinc-400">{copy.loading}</p>}
      {view.kind === "error" && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">{copy.readError}</Alert>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            {copy.retryButton}
          </Button>
        </div>
      )}
      {view.kind === "ready" && (
        <>
          <div className="flex flex-col gap-2">
            <h5 className="font-medium text-zinc-900 dark:text-zinc-50">{copy.noticeHeading}</h5>
            <ul className="list-disc pl-5 text-zinc-700 dark:text-zinc-300">
              {copy.noticePoints(name).map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <details>
              <summary className="cursor-pointer font-medium text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-zinc-50">
                {copy.disclosureSummary}
              </summary>
              <ul className="mt-2 list-disc pl-5 text-zinc-700 dark:text-zinc-300">
                {copy.disclosurePoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </details>
          </div>
          <p className="font-medium text-zinc-900 dark:text-zinc-50">
            {view.contributing ? copy.stateContributing : copy.stateNotContributing}
          </p>
          {view.contributing ? (
            <div>
              <Button type="button" variant="secondary" pending={pending !== null} onClick={() => void change("withdraw")}>
                {pending === "withdraw" ? copy.saving : copy.withdrawButton}
              </Button>
            </div>
          ) : view.canOptIn ? (
            <div>
              <Button type="button" pending={pending !== null} onClick={() => void change("opt-in")}>
                {pending === "opt-in" ? copy.saving : copy.optInButton}
              </Button>
            </div>
          ) : (
            <p className="text-zinc-600 dark:text-zinc-400">{copy.optInUnavailable}</p>
          )}
        </>
      )}
      {message && <Alert variant={message.kind === "error" ? "error" : "info"}>{message.text}</Alert>}
    </section>
  );
}

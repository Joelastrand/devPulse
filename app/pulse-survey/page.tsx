import { PulseSurveyForm } from "../../src/features/pulse-survey/components/PulseSurveyForm";
import { listActiveTeams } from "../../src/features/teams/server/list-active-teams";

/**
 * Active teams can change at any time (an admin creating/disabling one) —
 * this page must read Firestore fresh on every request, never serve a
 * build-time-static snapshot of the team list (BR-31).
 */
export const dynamic = "force-dynamic";

/**
 * The public team selector is rendered server-side from the same
 * authoritative, unauthenticated `listActiveTeams` read the submission
 * endpoint validates against (docs/features/team-management/SPEC.md —
 * TASK-006, BR-31). A Firestore read failure renders an empty, unavailable
 * selector rather than ever falling back to the old static team list,
 * which could re-expose a disabled team.
 */
export default async function PulseSurveyPage() {
  const teamsResult = await listActiveTeams();
  const teams = teamsResult.ok ? teamsResult.teams : [];
  const teamsUnavailable = !teamsResult.ok;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-lg rounded-lg bg-white p-8 shadow-sm dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Weekly pulse survey
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Three quick questions about your week. Your answers are anonymous.
        </p>
        <PulseSurveyForm teams={teams} teamsUnavailable={teamsUnavailable} />
      </main>
    </div>
  );
}

import { Card } from "../../src/components/ui/Card";
import { PageHeader } from "../../src/components/ui/PageHeader";
import { PageShell } from "../../src/components/ui/PageShell";
import { PulseSurveyForm } from "../../src/features/pulse-survey/components/PulseSurveyForm";
import { pulseSurveyCopy } from "../../src/features/pulse-survey/copy";
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
    <PageShell center width="lg">
      <Card variant="elevated" padding="lg">
        <PageHeader title={pulseSurveyCopy.page.title} description={pulseSurveyCopy.page.description} />
        <PulseSurveyForm teams={teams} teamsUnavailable={teamsUnavailable} />
      </Card>
    </PageShell>
  );
}

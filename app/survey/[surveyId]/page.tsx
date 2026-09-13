import { Card } from "../../../src/components/ui/Card";
import { PageShell } from "../../../src/components/ui/PageShell";
import { SurveyParticipationView } from "../../../src/features/surveys/components/SurveyParticipationView";

/**
 * One URL shape for both access modes (docs/features/managed-surveys/
 * SPEC.md — BR-10). Kept thin: every lifecycle/access-mode/authorization
 * decision is `SurveyParticipationView`'s server-backed resolution, never
 * duplicated here.
 */
export default async function SurveyParticipationPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  const { surveyId } = await params;

  return (
    <PageShell center width="lg">
      <Card variant="elevated" padding="lg">
        <SurveyParticipationView surveyId={surveyId} />
      </Card>
    </PageShell>
  );
}

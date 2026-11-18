import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";
import { SurveyWorkspace } from "../../../../../src/features/surveys/components/workspace/SurveyWorkspace";

/**
 * `/teams/[teamId]/surveys` (team-survey-builder TSB-006). The server page
 * renders only the shared header and a back link. The workspace loads its data
 * client-side through admin-authorized endpoints, which enforce access on the server.
 */
export default async function TeamSurveysPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamPageHeader teamId={teamId} />
      <div className="mt-6 flex flex-col gap-6">
        <SurveyWorkspace teamId={teamId} />
      </div>
    </PageShell>
  );
}

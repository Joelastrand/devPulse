import { PageShell } from "../../../../../src/components/ui/PageShell";
import { TeamSkillStatus } from "../../../../../src/features/team-owned-skills/components/TeamSkillStatus";
import { TeamSkillsAdmin } from "../../../../../src/features/team-owned-skills/components/TeamSkillsAdmin";
import { teamSkillsCopy } from "../../../../../src/features/team-owned-skills/copy";
import { TeamPageHeader } from "../../../../../src/features/teams/components/TeamPageHeader";

/**
 * `/teams/[teamId]/skills` (docs/features/team-owned-skills/SPEC.md §4). The team's own skill definitions. The server
 * authorizes every read and write; this page renders the shared header and the client administration component.
 */
export default async function TeamSkillsRoutePage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <PageShell width="3xl">
      <TeamPageHeader teamId={teamId} />
      <section aria-labelledby="team-skills-heading" className="mt-6 flex flex-col gap-4">
        <h2 id="team-skills-heading" className="text-xl font-semibold text-text-primary">
          {teamSkillsCopy.heading}
        </h2>
        <TeamSkillStatus teamId={teamId} />
        <TeamSkillsAdmin teamId={teamId} />
      </section>
    </PageShell>
  );
}

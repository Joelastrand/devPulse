import { redirect } from "next/navigation";

/**
 * `/teams/[teamId]/skills` is retired. Team competence areas are administered on the one Teamkompetanse page; old
 * links are sent there so no second competence entry point remains.
 */
export default async function TeamSkillsRetiredPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  redirect(`/teams/${encodeURIComponent(teamId)}/competence`);
}

import { TeamDetail } from "../../../src/features/teams/components/TeamDetail";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-3xl">
        <TeamDetail teamId={teamId} />
      </main>
    </div>
  );
}

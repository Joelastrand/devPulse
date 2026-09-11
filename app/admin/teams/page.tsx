import { AdminTeams } from "../../../src/features/teams/components/AdminTeams";

export default function AdminTeamsPage() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Admin: Teams
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Create teams and enable or disable existing ones.
        </p>
        <div className="mt-6">
          <AdminTeams />
        </div>
      </main>
    </div>
  );
}

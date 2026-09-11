import { TeamsOverview } from "../../src/features/teams/components/TeamsOverview";

export default function TeamsPage() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Teams
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Every active team and your own relationship to it.
        </p>
        <div className="mt-6">
          <TeamsOverview />
        </div>
      </main>
    </div>
  );
}

import { Dashboard } from "../../src/features/results/components/Dashboard";

export default function ResultsPage() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Team results
        </h1>
        <div className="mt-6">
          <Dashboard />
        </div>
      </main>
    </div>
  );
}

import { ResultsRedirect } from "../../src/features/results/components/ResultsRedirect";

export default function ResultsPage() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-3xl">
        <ResultsRedirect />
      </main>
    </div>
  );
}

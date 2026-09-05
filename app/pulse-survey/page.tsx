import { PulseSurveyForm } from "../../src/features/pulse-survey/components/PulseSurveyForm";

export default function PulseSurveyPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-lg rounded-lg bg-white p-8 shadow-sm dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Weekly pulse survey
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Three quick questions about your week. Your answers are anonymous.
        </p>
        <PulseSurveyForm />
      </main>
    </div>
  );
}

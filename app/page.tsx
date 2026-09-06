export default function Home() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-2xl">
        <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
          DevPulse
        </h1>
        <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
          A short, recurring pulse survey for developers — flow and delivery
          satisfaction, sustainable workload and stress, and fun and
          motivation.
        </p>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Individual responses are anonymous. Only your team&apos;s
          aggregated trends are shown, never individual scores.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/pulse-survey"
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Answer pulse
          </a>
          <a
            href="/results"
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            View results
          </a>
          <a
            href="/sign-in"
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Sign in
          </a>
          <a
            href="/sign-up"
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Create account
          </a>
        </div>
      </main>
    </div>
  );
}

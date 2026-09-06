import { SignUpForm } from "../../src/features/auth/components/SignUpForm";

export default function SignUpPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Create an account
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          You&apos;ll need to verify your email before your team&apos;s
          dashboard becomes available.
        </p>
        <SignUpForm />
      </main>
    </div>
  );
}

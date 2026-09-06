import { SignInForm } from "../../src/features/auth/components/SignInForm";

export default function SignInPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Sign in
        </h1>
        <SignInForm />
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          Don&apos;t have an account?{" "}
          <a
            href="/sign-up"
            className="font-medium text-zinc-900 underline dark:text-zinc-50"
          >
            Create one
          </a>
        </p>
      </main>
    </div>
  );
}

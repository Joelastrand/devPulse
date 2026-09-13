import Link from "next/link";
import { Card } from "../../src/components/ui/Card";
import { PageHeader } from "../../src/components/ui/PageHeader";
import { PageShell } from "../../src/components/ui/PageShell";
import { SignInForm } from "../../src/features/auth/components/SignInForm";
import { authCopy } from "../../src/features/auth/copy";

interface SignInPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * The `continue` value is untrusted, raw query input — it is forwarded to
 * `SignInForm` unvalidated, and only ever turned into an actual redirect
 * target by `resolveSignInDestination` (docs/features/managed-surveys/
 * SPEC.md — BR-40), never used directly by this page.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { continue: continuation } = await searchParams;

  return (
    <PageShell center width="sm">
      <Card variant="elevated" padding="lg">
        <PageHeader title={authCopy.signIn.pageTitle} />
        <SignInForm continuation={continuation} />
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          {authCopy.signIn.signUpPrompt}{" "}
          <Link
            href="/sign-up"
            className="font-medium text-zinc-900 underline dark:text-zinc-50"
          >
            {authCopy.signIn.signUpLink}
          </Link>
        </p>
      </Card>
    </PageShell>
  );
}

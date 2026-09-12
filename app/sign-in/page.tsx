import Link from "next/link";
import { Card } from "../../src/components/ui/Card";
import { PageHeader } from "../../src/components/ui/PageHeader";
import { PageShell } from "../../src/components/ui/PageShell";
import { SignInForm } from "../../src/features/auth/components/SignInForm";
import { authCopy } from "../../src/features/auth/copy";

export default function SignInPage() {
  return (
    <PageShell center width="sm">
      <Card variant="elevated" padding="lg">
        <PageHeader title={authCopy.signIn.pageTitle} />
        <SignInForm />
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

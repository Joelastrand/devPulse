import { Card } from "../../src/components/ui/Card";
import { PageHeader } from "../../src/components/ui/PageHeader";
import { PageShell } from "../../src/components/ui/PageShell";
import { SignUpForm } from "../../src/features/auth/components/SignUpForm";
import { authCopy } from "../../src/features/auth/copy";

export default function SignUpPage() {
  return (
    <PageShell center width="sm">
      <Card variant="elevated" padding="lg">
        <PageHeader
          title={authCopy.signUp.pageTitle}
          description={authCopy.signUp.pageDescription}
        />
        <SignUpForm />
      </Card>
    </PageShell>
  );
}

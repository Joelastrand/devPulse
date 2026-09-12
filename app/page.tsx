import Link from "next/link";
import { buttonClassName } from "../src/components/ui/Button";
import { PageHeader } from "../src/components/ui/PageHeader";
import { PageShell } from "../src/components/ui/PageShell";
import { homeCopy } from "./page.copy";

export default function Home() {
  const { title, description, privacyNote, actions } = homeCopy;

  return (
    <PageShell width="2xl">
      <PageHeader title={title} size="lg" />
      <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">{description}</p>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{privacyNote}</p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={actions.answerPulse.href} className={buttonClassName({ variant: "primary" })}>
          {actions.answerPulse.label}
        </Link>
        <Link href={actions.viewResults.href} className={buttonClassName({ variant: "secondary" })}>
          {actions.viewResults.label}
        </Link>
        <Link href={actions.signIn.href} className={buttonClassName({ variant: "secondary" })}>
          {actions.signIn.label}
        </Link>
        <Link href={actions.createAccount.href} className={buttonClassName({ variant: "secondary" })}>
          {actions.createAccount.label}
        </Link>
      </div>
    </PageShell>
  );
}

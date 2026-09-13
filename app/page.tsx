"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClassName } from "../src/components/ui/Button";
import { PageHeader } from "../src/components/ui/PageHeader";
import { PageShell } from "../src/components/ui/PageShell";
import { useAuthGatedResource } from "../src/features/auth/client/use-auth-gated-resource";
import { homeCopy } from "./page.copy";

/**
 * Home (docs/features/managed-surveys/SPEC.md — BR-38, BR-39). Auth-aware:
 * a signed-out visitor gets "Logg inn"/"Opprett konto"; a signed-in visitor
 * gets "Mine team" instead and never the sign-in/sign-up actions. There is
 * no generic public-survey CTA any more — survey participation happens only
 * via a generated `/survey/{surveyId}` link (team page or shared
 * externally), never a Home entry point.
 *
 * Before the first `observeIdToken` emission, this fails closed to the
 * signed-out action set — the same "never optimistically show a signed-in-
 * only action" convention `SiteHeader` already uses — rather than
 * momentarily showing "Mine team" to a visitor who turns out to be signed
 * out.
 */
export default function Home() {
  const { title, description, privacyNote, actions } = homeCopy;
  const [isSignedIn, setIsSignedIn] = useState(false);

  useAuthGatedResource((token) => {
    setIsSignedIn(token !== null);
  });

  return (
    <PageShell width="2xl">
      <PageHeader title={title} size="lg" />
      <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">{description}</p>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{privacyNote}</p>

      <div className="mt-8 flex flex-wrap gap-3">
        {isSignedIn ? (
          <Link href={actions.myTeams.href} className={buttonClassName({ variant: "primary" })}>
            {actions.myTeams.label}
          </Link>
        ) : (
          <>
            <Link href={actions.signIn.href} className={buttonClassName({ variant: "primary" })}>
              {actions.signIn.label}
            </Link>
            <Link href={actions.createAccount.href} className={buttonClassName({ variant: "secondary" })}>
              {actions.createAccount.label}
            </Link>
          </>
        )}
      </div>
    </PageShell>
  );
}

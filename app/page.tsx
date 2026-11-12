"use client";

import Link from "next/link";
import { Layers, Shield, ShieldCheck, Target, TrendingUp, Users } from "lucide-react";
import { useState } from "react";
import { AppShell } from "../src/components/nav/AppShell";
import { PublicHeader } from "../src/components/nav/PublicHeader";
import { TeamContextProvider } from "../src/components/nav/TeamContext";
import { buttonClassName } from "../src/components/ui/Button";
import { Icon } from "../src/components/ui/Icon";
import { SKIP_LINK_TARGET_ID } from "../src/components/ui/SkipLink";
import { useAuthGatedResource } from "../src/features/auth/client/use-auth-gated-resource";
import { AuthenticatedHome } from "../src/features/home/components/AuthenticatedHome";
import { HomePreview } from "../src/features/home/components/HomePreview";
import { homeCopy } from "./page.copy";

type HomeAuthState = "unknown" | "signed_out" | "signed_in";

const VALUE_ICONS = [TrendingUp, Layers, Target] as const;
const TRUST_ICONS = [Shield, Users] as const;

/**
 * Home (docs/archive/features/managed-surveys/SPEC.md — BR-38, BR-39). The route is
 * shared by both audiences, so it chooses the shell from the client's own
 * token:
 *
 * - signed out: the public top bar, the landing composition and the
 *   sign-in/sign-up actions;
 * - signed in: `AppShell` with the authenticated home, never sign-in actions.
 *
 * Before the first `observeIdToken` emission the page fails closed to the
 * signed-out view, the same convention `AppShell` uses, so it never shows
 * signed-in-only content to a visitor who turns out to be signed out.
 *
 * There is no generic public-survey CTA: survey participation happens only
 * via a generated `/survey/{surveyId}` link, never a Home entry point.
 */
export default function Home() {
  const { eyebrow, headline, description, values, trust, actions } = homeCopy;
  const [authState, setAuthState] = useState<HomeAuthState>("unknown");

  useAuthGatedResource((token) => {
    setAuthState(token === null ? "signed_out" : "signed_in");
  });

  if (authState === "signed_in") {
    return (
      <TeamContextProvider>
        <AppShell>
          <AuthenticatedHome />
        </AppShell>
      </TeamContextProvider>
    );
  }

  return (
    <>
      <PublicHeader />
      <div id={SKIP_LINK_TARGET_ID} tabIndex={-1} className="flex flex-1 flex-col">
        <main className="flex flex-1 flex-col">
          <section className="mx-auto grid w-full max-w-main grid-cols-1 items-center gap-12 px-4 pb-16 pt-12 md:grid-cols-2 md:px-8 md:pb-6 md:pt-20">
            <div className="flex flex-col gap-6">
              <p className="w-fit rounded-full bg-surface-subtle px-4 py-1.5 text-label font-medium text-text-secondary">
                {eyebrow}
              </p>
              <h1 className="text-page-title font-semibold text-text-primary md:text-[3.25rem] md:leading-[3.5rem]">
                {headline}
              </h1>
              <p className="text-body text-text-secondary md:text-lg">{description}</p>
              <div className="flex flex-wrap gap-3">
                <Link href={actions.signIn.href} className={buttonClassName({ variant: "primary" })}>
                  {actions.signIn.label}
                </Link>
                <Link href={actions.createAccount.href} className={buttonClassName({ variant: "secondary" })}>
                  {actions.createAccount.label}
                </Link>
              </div>
            </div>
            <HomePreview />
          </section>

          <section className="mx-auto grid w-full max-w-main grid-cols-1 gap-6 px-4 pb-16 md:grid-cols-3 md:pb-6 md:px-8">
            {values.map((value, index) => {
              const ValueIcon = VALUE_ICONS[index] ?? TrendingUp;
              return (
                <div key={value.title} className="flex gap-4">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-primary-subtle text-primary">
                    <Icon icon={ValueIcon} />
                  </span>
                  <div className="flex flex-col gap-1">
                    <h2 className="text-panel-title font-semibold text-text-primary">{value.title}</h2>
                    <p className="text-body-secondary text-text-secondary">{value.description}</p>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="bg-brand-900 text-sidebar-foreground">
            <ul className="mx-auto grid w-full max-w-main grid-cols-1 gap-6 px-4 py-10 md:py-6 sm:grid-cols-2 md:px-8">
              {trust.map((item, index) => {
                const TrustIcon = TRUST_ICONS[index] ?? ShieldCheck;
                return (
                  <li key={item.title} className="flex items-start gap-3">
                    <Icon icon={TrustIcon} />
                    <div className="flex flex-col gap-0.5">
                      <p className="font-semibold">{item.title}</p>
                      <p className="text-help text-sidebar-muted">{item.description}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </main>
      </div>
    </>
  );
}

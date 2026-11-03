import Link from "next/link";
import { Card } from "../../../../src/components/ui/Card";
import { Icon } from "../../../../src/components/ui/Icon";
import { PageShell } from "../../../../src/components/ui/PageShell";
import { Section } from "../../../../src/components/ui/Section";
import { ProfileForm } from "../../../../src/features/profiles/components/ProfileForm";
import { profileCopy } from "../../../../src/features/profiles/copy";
import { ErasureEntryLink } from "../../../../src/features/account-erasure/components/ErasureEntryLink";
import { ChevronRight, Users, UserRound } from "lucide-react";

/**
 * Profile workspace (docs/design/references/13-my-profile.png). Only supported
 * fields appear: the display name form, team membership and account actions.
 * The avatar is a neutral placeholder because no profile photo exists.
 */
export default function ProfilePage() {
  return (
    <PageShell width="wide">
      <section className="relative flex flex-col gap-6 overflow-hidden rounded-surface border border-border-subtle bg-surface px-6 py-8 shadow-card sm:flex-row sm:items-center md:px-8">
        <svg
          viewBox="0 0 640 160"
          preserveAspectRatio="xMaxYMax slice"
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-3/5"
        >
          <path d="M0 110 C 120 60, 230 120, 340 84 S 520 60, 640 80 V160 H0 Z" className="fill-brand-100" />
          <path d="M0 136 C 130 110, 250 146, 380 124 S 540 112, 640 124 V160 H0 Z" className="fill-brand-200" />
          <g className="fill-brand-700">
            <path d="M540 160 L566 96 L592 160 Z" />
            <path d="M574 160 L598 84 L622 160 Z" />
          </g>
        </svg>
        <span
          aria-hidden="true"
          className="relative flex size-20 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-subtle text-primary"
        >
          <Icon icon={UserRound} size="feature" />
        </span>
        <div className="relative flex min-w-0 flex-col gap-2">
          <h1 className="text-metric font-semibold text-text-primary">{profileCopy.pageTitle}</h1>
          <p className="text-body text-text-secondary">{profileCopy.pageDescription}</p>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <ProfileForm />
        </div>
        <aside aria-label={profileCopy.accountTitle} className="flex flex-col gap-4">
          <Card as="section" variant="bordered" padding="md" className="flex flex-col gap-3">
            <Section title={profileCopy.teamsTitle} description={profileCopy.teamsDescription}>
              <Link
                href="/teams"
                className="flex items-center justify-between gap-3 rounded-control border border-border-subtle bg-surface-subtle px-3 py-3 text-sm font-medium text-text-primary"
              >
                <span className="flex items-center gap-2">
                  <Icon icon={Users} />
                  {profileCopy.teamsLink}
                </span>
                <Icon icon={ChevronRight} size="inline" className="text-text-muted" />
              </Link>
            </Section>
          </Card>
          <Card as="section" variant="bordered" padding="md" className="flex flex-col gap-3">
            <Section title={profileCopy.accountTitle} description={profileCopy.accountDescription}>
              <div className="flex items-center gap-2 rounded-control border border-border-subtle bg-surface-subtle px-3 py-3">
                <Icon icon={UserRound} />
                <ErasureEntryLink />
              </div>
            </Section>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}

import Link from "next/link";
import { buttonClassName } from "../../../../src/components/ui/Button";
import { Card } from "../../../../src/components/ui/Card";
import { Icon } from "../../../../src/components/ui/Icon";
import { PageShell } from "../../../../src/components/ui/PageShell";
import { Section } from "../../../../src/components/ui/Section";
import { ProfileForm } from "../../../../src/features/profiles/components/ProfileForm";
import { ProfileHeaderName } from "../../../../src/features/profiles/components/ProfileHeaderName";
import { ProfileHeaderTeams } from "../../../../src/features/profiles/components/ProfileHeaderTeams";
import { profileCopy } from "../../../../src/features/profiles/copy";
import { ErasureEntryLink } from "../../../../src/features/account-erasure/components/ErasureEntryLink";
import { ChevronRight, IdCard, Pencil, Users, UserRound } from "lucide-react";

/**
 * Profile workspace (docs/archive/design/references/13-my-profile.png). Only supported
 * fields appear: the display name form, team membership and account actions.
 * The avatar is a neutral placeholder because no profile photo exists.
 */
export default function ProfilePage() {
  return (
    <PageShell width="wide">
      <section className="relative flex flex-col gap-6 overflow-hidden rounded-surface border border-border-subtle bg-surface px-6 py-8 shadow-card sm:flex-row sm:items-center md:px-8">
        <span
          aria-hidden="true"
          className="relative flex size-20 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-subtle text-primary"
        >
          <Icon icon={UserRound} size="feature" />
        </span>
        <div className="relative flex min-w-0 flex-col gap-2">
          <h1 className="text-metric font-semibold text-text-primary">{profileCopy.pageTitle}</h1>
          <p className="text-body text-text-secondary">{profileCopy.pageDescription}</p>
          <ProfileHeaderName />
          <ProfileHeaderTeams />
          <Link href="#profile-form" className={buttonClassName({ variant: "primary" }) + " w-fit"}>
            <Icon icon={Pencil} size="inline" />
            {profileCopy.editAction}
          </Link>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <ProfileForm />
          <Card as="section" variant="bordered" padding="md" className="flex flex-col gap-3">
            <Section
              title={profileCopy.accountTitle}
              description={profileCopy.accountDescription}
              icon={<Icon icon={UserRound} size="inline" />}
            >
              <div className="flex items-center gap-2 rounded-control border border-border-subtle bg-surface-subtle px-3 py-3">
                <Icon icon={UserRound} />
                <ErasureEntryLink />
              </div>
            </Section>
          </Card>
        </div>
        <aside aria-label={profileCopy.teamsTitle} className="flex flex-col gap-4">
          <Card as="section" variant="bordered" padding="md" className="flex flex-col gap-3">
            <Section
              title={profileCopy.teamsTitle}
              description={profileCopy.teamsDescription}
              icon={<Icon icon={Users} size="inline" />}
            >
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
          {/* Privacy boundary note: the existing field description, reused as is (decision A, TASK-016). */}
          <Card as="section" variant="bordered" padding="md" className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-card-title font-semibold text-text-primary">
              <Icon icon={IdCard} size="inline" />
              {profileCopy.fieldLabel}
            </h2>
            <p className="text-help text-text-secondary">{profileCopy.fieldDescription}</p>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}

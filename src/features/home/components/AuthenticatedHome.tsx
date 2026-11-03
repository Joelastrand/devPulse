import Link from "next/link";
import { ArrowRight, ChevronRight, Layers, MessageSquare, Target, UserRound, Users, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "../../../components/ui/Card";
import { Icon } from "../../../components/ui/Icon";
import { PageShell } from "../../../components/ui/PageShell";
import { Section } from "../../../components/ui/Section";
import { TeamsOverview } from "../../teams/components/TeamsOverview";
import { authenticatedHomeCopy } from "../copy";

interface ShortcutLink {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

const SHORTCUTS: readonly ShortcutLink[] = [
  { ...authenticatedHomeCopy.links.teams, icon: Users },
  { ...authenticatedHomeCopy.links.skills, icon: Layers },
  { ...authenticatedHomeCopy.links.goals, icon: Target },
  { ...authenticatedHomeCopy.links.conversations, icon: MessageSquare },
];

const NEXT_STEPS: readonly ShortcutLink[] = [
  { ...authenticatedHomeCopy.nextSteps.teamNeeds, icon: Layers },
  { ...authenticatedHomeCopy.nextSteps.conversation, icon: MessageSquare },
  { ...authenticatedHomeCopy.nextSteps.roles, icon: UserRound },
];

/**
 * Landscape band for the greeting. Original shapes in the brand greens,
 * decorative only.
 */
function GreetingLandscape() {
  return (
    <svg
      viewBox="0 0 640 200"
      preserveAspectRatio="xMaxYMax slice"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-y-0 right-0 h-full w-full md:w-3/5"
    >
      <path d="M0 120 C 120 70, 220 130, 330 96 S 520 60, 640 88 V200 H0 Z" className="fill-brand-100" />
      <path d="M0 150 C 140 118, 260 166, 380 140 S 560 118, 640 132 V200 H0 Z" className="fill-brand-200" />
      <g className="fill-brand-700">
        <path d="M520 200 L548 124 L576 200 Z" />
        <path d="M556 200 L584 110 L612 200 Z" />
        <path d="M596 200 L620 142 L640 200 Z" />
      </g>
    </svg>
  );
}

/**
 * Authenticated home (docs/design/references/03-app-home.png). Rendered only
 * inside `AppShell` after the client has a signed-in token. Every link goes to
 * an existing route. The team list comes from the existing `TeamsOverview`,
 * which keeps its own auth and privacy handling. No metric or personal data is
 * computed here.
 */
export function AuthenticatedHome() {
  return (
    <PageShell width="wide">
      <section className="relative overflow-hidden rounded-surface border border-border-subtle bg-surface px-6 py-8 shadow-card md:px-8 md:py-10">
        <GreetingLandscape />
        <div className="relative flex max-w-xl flex-col gap-2">
          <h1 className="text-metric font-semibold text-text-primary">{authenticatedHomeCopy.title}</h1>
          <p className="text-body text-text-secondary">{authenticatedHomeCopy.description}</p>
        </div>
      </section>

      <nav aria-label={authenticatedHomeCopy.quickLinksLabel} className="mt-6">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SHORTCUTS.map((link) => (
            <Card key={link.href} as="li" variant="bordered" padding="md" className="transition-shadow hover:shadow-elevated">
              <Link href={link.href} className="flex h-full flex-col gap-4 rounded-control">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-control bg-primary-subtle text-primary">
                    <Icon icon={link.icon} size="feature" />
                  </span>
                  <Icon icon={ArrowRight} size="inline" className="text-text-muted" />
                </div>
                <span className="flex flex-col gap-1">
                  <span className="font-semibold text-text-primary">{link.label}</span>
                  <span className="text-sm text-text-secondary">{link.description}</span>
                </span>
              </Link>
            </Card>
          ))}
        </ul>
      </nav>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section title={authenticatedHomeCopy.teamsSectionTitle} description={authenticatedHomeCopy.teamsSectionDescription}>
          <TeamsOverview />
        </Section>

        <Card as="section" variant="bordered" padding="md" aria-labelledby="home-next-steps" className="flex flex-col gap-4 self-start">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-control bg-primary-subtle text-primary">
              <Icon icon={Zap} />
            </span>
            <h2 id="home-next-steps" className="text-section-title font-semibold text-text-primary">
              {authenticatedHomeCopy.nextStepsTitle}
            </h2>
          </div>
          <ul className="flex flex-col gap-2">
            {NEXT_STEPS.map((step) => (
              <li key={step.href}>
                <Link
                  href={step.href}
                  className="flex items-center gap-3 rounded-control border border-border-subtle bg-surface-subtle px-3 py-3 hover:bg-surface"
                >
                  <Icon icon={step.icon} className="shrink-0 text-primary" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-text-primary">{step.label}</span>
                    <span className="text-help text-text-muted">{step.description}</span>
                  </span>
                  <Icon icon={ChevronRight} size="inline" className="shrink-0 text-text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </PageShell>
  );
}

import Link from "next/link";
import { Layers, TrendingUp, Users } from "lucide-react";
import { Card } from "../../../src/components/ui/Card";
import { Icon } from "../../../src/components/ui/Icon";
import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { SignedInRedirect } from "../../../src/features/auth/components/SignedInRedirect";
import { SignInForm } from "../../../src/features/auth/components/SignInForm";
import { authCopy } from "../../../src/features/auth/copy";
import { SidebarLandscape } from "../../../src/components/nav/SidebarLandscape";

interface SignInPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Sign-in panel copy. The three points describe existing features only:
 * pulse follow-up, goals and conversations, and team competency planning.
 */
const SIGN_IN_PANEL = {
  headline: "Utvikling for deg og teamet ditt",
  points: [
    {
      title: "Følg utvikling",
      description: "Få innsikt i trivsel, kompetanse og utviklingsbehov.",
      icon: TrendingUp,
    },
    {
      title: "Jobb mot tydelige mål",
      description: "Sett mål, ha utviklingssamtaler og følg fremdriften.",
      icon: Layers,
    },
    {
      title: "Styrk teamet",
      description: "Planlegg kompetanseutvikling og skap et godt læringsmiljø.",
      icon: Users,
    },
  ],
} as const;

/**
 * The `continue` value is untrusted, raw query input — it is forwarded to
 * `SignInForm` unvalidated, and only ever turned into an actual redirect
 * target by `resolveSignInDestination` (docs/archive/features/managed-surveys/
 * SPEC.md — BR-40), never used directly by this page.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { continue: continuation } = await searchParams;

  return (
    <PageShell width="3xl">
      <div className="relative grid grid-cols-1 items-center gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16 lg:py-16">
        <SidebarLandscape className="lg:inset-x-auto lg:right-0 lg:h-full lg:w-1/2" />
        <section aria-label={SIGN_IN_PANEL.headline} className="relative flex flex-col gap-6">
          <p className="text-page-title font-semibold text-text-primary lg:text-[2.5rem] lg:leading-[3rem]">
            {SIGN_IN_PANEL.headline}
          </p>
          <ul className="flex flex-col gap-6">
            {SIGN_IN_PANEL.points.map((point) => (
              <li key={point.title} className="flex items-start gap-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-primary-subtle text-primary">
                  <Icon icon={point.icon} />
                </span>
                <div className="flex flex-col gap-1">
                  <p className="font-semibold text-text-primary">{point.title}</p>
                  <p className="text-body-secondary text-text-secondary">{point.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <Card variant="elevated" padding="lg" className="relative">
          <PageHeader title={authCopy.signIn.pageTitle} />
          <SignedInRedirect continuation={continuation} />
          <SignInForm continuation={continuation} />
          <p className="mt-6 text-sm text-text-secondary">
            {authCopy.signIn.signUpPrompt}{" "}
            <Link href="/sign-up" className="font-medium text-text-primary underline">
              {authCopy.signIn.signUpLink}
            </Link>
          </p>
        </Card>
      </div>
    </PageShell>
  );
}

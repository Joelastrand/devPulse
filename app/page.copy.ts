/**
 * Norwegian user-facing copy for the Home page (`app/page.tsx`).
 *
 * Establishes this repository's lightweight copy-module convention
 * (docs/features/product-ux-shell/SPEC.md — BR-2): a plain, page/feature-
 * scoped module of Norwegian string constants, imported directly by its
 * component — not an i18n library, not locale-routed. Home has no owning
 * `src/features/` slice, so its copy is colocated next to the route file
 * itself, mirroring `app/page.test.tsx`'s existing colocation; a page that
 * belongs to a feature (pulse survey, auth, teams, admin) places its copy
 * module under that feature instead (e.g. `src/features/teams/copy.ts`).
 */
export const homeCopy = {
  title: "DevPulse",
  description:
    "En kort, tilbakevendende pulsmåling for utviklere — arbeidsflyt og leveransetilfredshet, bærekraftig arbeidsmengde og stress, og glede og motivasjon.",
  privacyNote:
    "Individuelle svar er anonyme. Bare teamets samlede trender vises, aldri individuelle poeng.",
  actions: {
    answerPulse: { label: "Svar på pulsmåling", href: "/pulse-survey" },
    viewResults: { label: "Se resultater", href: "/results" },
    signIn: { label: "Logg inn", href: "/sign-in" },
    createAccount: { label: "Opprett konto", href: "/sign-up" },
  },
} as const;

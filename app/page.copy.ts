const privacyNote =
  "Svarene lagres uten navn eller e-postadresse. Individuelle svar vises aldri. Teamet ser bare samlede resultater, og først når nok personer har svart.";

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
 *
 * Value and trust items describe existing features only (pulse, competency
 * tree, goals, conversations, privacy rules). They make no performance claim.
 */
export const homeCopy = {
  title: "DevPulse",
  eyebrow: "Teamutvikling for moderne utviklingsteam",
  headline: "Fra innsikt til utvikling – sammen",
  description:
    "En kort, tilbakevendende pulsmåling for utviklere — arbeidsflyt og leveransetilfredshet, bærekraftig arbeidsmengde og stress, og glede og motivasjon.",
  privacyNote,
  values: [
    {
      title: "Følg utvikling",
      description: "Få innsikt i arbeidsflyt, trivsel og utviklingsbehov på teamnivå.",
    },
    {
      title: "Utvikle kompetanse",
      description: "Synliggjør kompetansebehov, dekk hull og planlegg utvikling sammen.",
    },
    {
      title: "Skap fremdrift",
      description: "Sett mål, ha utviklingssamtaler og følg felles planer i én arbeidsflate.",
    },
  ],
  trust: [
    {
      title: "Personvern først",
      description: privacyNote,
    },
    { title: "Bygget for team", description: "Samarbeid, læring og utvikling" },
  ],
  actions: {
    signIn: { label: "Logg inn", href: "/sign-in" },
    createAccount: { label: "Opprett konto", href: "/sign-up" },
  },
} as const;

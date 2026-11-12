/**
 * User-facing copy for the account erasure flow (TASK-039). Norwegian, per docs/archive/UI-UX-2026-11-11.md. The consequences follow the SPEC
 * "Confirmation and recent-authentication semantics" list. The copy never claims deletion from provider logs (BR-19), never
 * offers an undo or recovery (AE-SI-11), and never shows an identifier, an e-mail address, or raw error text (AE-SI-2).
 */
export const erasureCopy = {
  pageTitle: "Slett kontoen din",
  pageDescription:
    "Dette sletter DevPulse-kontoen din og personopplysningene dine. Handlingen kan ikke angres, og det finnes ingen karenstid.",
  consequencesTitle: "Dette skjer når du sletter kontoen",
  consequences: [
    "Alle personopplysningene dine i DevPulse slettes, inkludert ferdighetsnivåer, mål, rollemål, profilnavn, egenvurderinger og deltakelse i undersøkelser.",
    "Medlemskapene dine i team fjernes, også eventuell lederrolle.",
    "Utviklingssamtaler du eier, slettes, og deltakerne mister tilgangen. Deltakerne varsles ikke.",
    "Innlegg og svar du har skrevet i forumet, fjernes. Tråder der andre har svart, vises som slettet.",
    "Innloggingskontoen din hos Firebase slettes.",
    "Handlingen kan ikke angres, og det finnes ingen karenstid.",
  ],
  emailLabel: "Skriv inn e-postadressen din for å bekrefte",
  emailHint: "Bruk samme e-postadresse som kontoen din.",
  passwordLabel: "Passord (for å bekrefte at det er deg)",
  submit: "Slett kontoen",
  cancel: "Avbryt",
  profileLinkLabel: "Slett kontoen din",
  submitting: "Sletter kontoen …",
  progress: "Slettingen pågår. Ikke lukk siden før den er ferdig.",
  completedTitle: "Kontoen er slettet",
  completedBody: "Kontoen din er slettet, og du er logget ut.",
  completedAnnouncement: "Kontoen er slettet.",
  errors: {
    required: "Fyll inn både e-postadressen og passordet.",
    reauthFailed: "Passordet stemmer ikke. Prøv igjen.",
    recentAuthRequired: "Logg inn på nytt med passordet ditt, og prøv igjen.",
    confirmationMismatch: "E-postadressen stemmer ikke med kontoen din.",
    unavailable: "Slettingen kunne ikke fullføres akkurat nå. Prøv igjen senere.",
    unauthenticated: "Du må være innlogget for å slette kontoen.",
    lastSuperadmin: "Du er den eneste aktive superadministratoren, så kontoen kan ikke slettes ennå. Utnevn en annen superadministrator først, og prøv igjen.",
    generic: "Noe gikk galt. Prøv igjen.",
  },
} as const;

export type ErasureErrorCopyKey = keyof typeof erasureCopy.errors;

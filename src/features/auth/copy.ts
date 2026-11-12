/**
 * Norwegian user-facing copy for the auth screens (`app/sign-in/page.tsx`,
 * `app/sign-up/page.tsx`, `SignInForm`, `SignUpForm`), per the copy-module
 * convention established in TASK-001
 * (docs/archive/features/product-ux-shell/SPEC.md — BR-2).
 */
export const authCopy = {
  signIn: {
    pageTitle: "Logg inn",
    emailLabel: "E-postadresse",
    passwordLabel: "Passord",
    submit: "Logg inn",
    submitting: "Logger inn…",
    success: "Du er logget inn.",
    continueLabel: "Fortsett til Team",
    continueToSurveyLabel: "Fortsett til undersøkelsen",
    error: "Ugyldig e-post eller passord.",
    signUpPrompt: "Har du ikke en konto?",
    signUpLink: "Opprett en",
  },
  signUp: {
    pageTitle: "Opprett konto",
    pageDescription:
      "DevPulse er for ansatte i NVE. Bruk e-postadressen din på nve.no. Du må bekrefte e-posten din før du kan bruke DevPulse.",
    emailLabel: "E-post",
    passwordLabel: "Passord",
    submit: "Opprett konto",
    submitting: "Oppretter konto…",
    notNveDomain:
      "DevPulse er bare for ansatte i NVE. Bruk e-postadressen din på nve.no.",
    error: "Noe gikk galt. Prøv igjen.",
  },
  verification: {
    createdHeading: "Sjekk e-posten din",
    createdDescription:
      "Vi har sendt deg en bekreftelseslenke på e-post. Åpne lenken for å aktivere kontoen din.",
    unverifiedHeading: "Bekreft e-posten din først",
    unverifiedDescription:
      "Kontoen din er ikke aktivert ennå. Åpne bekreftelseslenken i e-posten fra DevPulse, og logg deretter inn på nytt.",
    spamReminder:
      "Finner du ikke e-posten? Sjekk søppelpost eller spam-mappen. Det kan ta noen minutter før meldingen kommer frem.",
    loginAction: "Logg inn",
    resendAction: "Send bekreftelseslenke på nytt",
    resendPending: "Sender…",
    resendCooldown: (seconds: number) =>
      `Du kan be om en ny lenke om ${seconds} sekunder.`,
    resendSent:
      "Hvis kontoen din venter på bekreftelse, er en ny lenke sendt. Sjekk e-posten din.",
    resendFailed: "Vi kunne ikke sende lenken nå. Prøv igjen om litt.",
  },
} as const;

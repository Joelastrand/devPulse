/**
 * Norwegian user-facing copy for the auth screens (`app/sign-in/page.tsx`,
 * `app/sign-up/page.tsx`, `SignInForm`, `SignUpForm`), per the copy-module
 * convention established in TASK-001
 * (docs/features/product-ux-shell/SPEC.md — BR-2).
 */
export const authCopy = {
  signIn: {
    pageTitle: "Logg inn",
    emailLabel: "E-post",
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
      "Du må bekrefte e-posten din før teamets dashbord blir tilgjengelig.",
    emailLabel: "E-post",
    passwordLabel: "Passord",
    submit: "Opprett konto",
    submitting: "Oppretter konto…",
    success:
      "Konto opprettet. Sjekk e-posten din for en bekreftelseslenke — du må bekrefte e-posten din før teamets dashbord blir tilgjengelig.",
    error: "Noe gikk galt. Prøv igjen.",
  },
} as const;

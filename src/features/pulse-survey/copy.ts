/**
 * Norwegian user-facing copy for the pulse-survey screen (`app/pulse-
 * survey/page.tsx`, `PulseSurveyForm`), per the copy-module convention
 * established in TASK-001 (docs/features/product-ux-shell/SPEC.md — BR-2).
 *
 * The three dimension labels reuse the exact vocabulary already
 * established on the Home page (`app/page.copy.ts`'s `description`) —
 * "arbeidsflyt og leveransetilfredshet", "bærekraftig arbeidsmengde og
 * stress", "glede og motivasjon" — rather than introducing a second,
 * slightly different Norwegian phrasing for the same three dimensions.
 */
export const pulseSurveyCopy = {
  page: {
    title: "Ukentlig pulsmåling",
    description: "Tre raske spørsmål om uken din. Svarene dine er anonyme.",
  },
  questions: {
    flow: "Arbeidsflyt og leveransetilfredshet",
    stress: "Bærekraftig arbeidsmengde og stress",
    fun: "Glede og motivasjon",
  },
  teamLabel: "Team",
  teamPlaceholder: "Velg team",
  teamsUnavailable: "Teamlisten er utilgjengelig akkurat nå. Prøv igjen senere.",
  submit: "Send inn",
  submitting: "Sender inn…",
  success: "Takk — svaret ditt ble registrert.",
  error: "Noe gikk galt. Prøv igjen.",
} as const;

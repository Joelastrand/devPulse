/**
 * Norwegian user-facing copy for the team-results screens (`PeriodSummary`,
 * `TrendTable`, `TrendChart`, `ResultsRedirect`), per the copy-module
 * convention established in TASK-001 (docs/features/product-ux-shell/
 * SPEC.md — BR-2). Survey-instance wording (docs/features/managed-surveys/
 * SPEC.md — TASK-012): no "period"/week-based terminology — each entry is
 * one actual survey occurrence, never a fabricated calendar bucket.
 */

/**
 * The below-threshold message never states a count, only the survey's own
 * configured `minimumResponses` — the threshold itself is not sensitive
 * (docs/features/managed-surveys/SPEC.md — "Per-survey result threshold"),
 * but the actual response count must never appear alongside it.
 */
const insufficientMessage = (minimumResponses: number) =>
  `Resultatet vises når minst ${minimumResponses} personer har svart.`;

export const resultsCopy = {
  latestSurvey: {
    heading: "Siste undersøkelse",
    dimensions: {
      flow: "Arbeidsflyt",
      stress: "Stress",
      fun: "Glede",
    },
    responses: (count: number) => `${count} svar`,
    insufficient: insufficientMessage,
    empty: "Ingen avsluttede undersøkelser ennå.",
  },
  trendTable: {
    heading: "Siste undersøkelser",
    caption: "Gjennomsnitt per dimensjon for teamets siste avsluttede undersøkelser",
    columns: {
      date: "Dato",
      flow: "Arbeidsflyt",
      stress: "Stress",
      fun: "Glede",
      responses: "Svar",
    },
    empty: "Ingen avsluttede undersøkelser ennå.",
    insufficient: insufficientMessage,
  },
  trendChart: {
    heading: "Trendvisualisering",
    description:
      "Visuell fremstilling av de samme tallene som i tabellen under. Undersøkelser uten nok svar vises som et brudd i linjen, aldri som verdien null.",
  },
  redirect: {
    redirecting: "Omdirigerer…",
  },
} as const;

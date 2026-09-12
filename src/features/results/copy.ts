/**
 * Norwegian user-facing copy for the team-results screens (`PeriodSummary`,
 * `TrendTable`, `ResultsRedirect`), per the copy-module convention
 * established in TASK-001 (docs/features/product-ux-shell/SPEC.md — BR-2).
 */
export const resultsCopy = {
  periodSummary: {
    heading: "Sist avsluttede periode",
    dimensions: {
      flow: "Arbeidsflyt",
      stress: "Stress",
      fun: "Glede",
    },
    responses: (count: number) => `${count} svar`,
    insufficient: "Ikke nok svar ennå for denne perioden.",
    notAvailable: "Ikke tilgjengelig.",
  },
  trendTable: {
    heading: (periodCount: number) => `Trend (siste ${periodCount} avsluttede perioder)`,
    caption: "Gjennomsnitt per dimensjon for de siste avsluttede periodene",
    columns: {
      period: "Periode",
      flow: "Arbeidsflyt",
      stress: "Stress",
      fun: "Glede",
      responses: "Svar",
    },
    insufficient: "Ikke nok svar ennå",
    notAvailable: "Ikke tilgjengelig",
  },
  trendChart: {
    heading: "Trendvisualisering",
    description:
      "Visuell fremstilling av de samme tallene som i tabellen under. Perioder uten nok svar vises som et brudd i linjen, aldri som verdien null.",
  },
  redirect: {
    redirecting: "Omdirigerer…",
  },
} as const;

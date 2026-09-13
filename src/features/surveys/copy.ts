/**
 * Norwegian user-facing copy for `/survey/[surveyId]`
 * (`SurveyParticipationView`, `SurveyResponseForm`), per the copy-module
 * convention established in `docs/features/product-ux-shell/SPEC.md` BR-2.
 * Internal/technical outcome values (`"scheduled"`, `"forbidden"`, etc.)
 * are never shown to a user — each is mapped to plain Norwegian text here
 * (docs/features/managed-surveys/SPEC.md — "UI/UX requirements").
 *
 * The three question labels intentionally repeat `pulse-survey/copy.ts`'s
 * exact wording (the fixed question set is unchanged by this feature,
 * SPEC → Non-goals) as new, independent copy — `src/features/pulse-survey/`
 * is retired wholesale by TASK-014, not imported from here in the meantime.
 */
export const surveysCopy = {
  page: {
    loading: "Laster undersøkelse…",
    notFound: "Denne undersøkelsen finnes ikke.",
    scheduled: "Denne undersøkelsen har ikke startet ennå.",
    closed: "Denne undersøkelsen er avsluttet.",
    forbidden: "Du har ikke tilgang til denne undersøkelsen.",
    signInRequired: "for å svare på denne undersøkelsen.",
    signInLink: "Logg inn",
    readFailed: "Noe gikk galt under lasting av undersøkelsen. Prøv igjen senere.",
    fallbackTitle: "Undersøkelse",
  },
  questions: {
    flow: "Arbeidsflyt og leveransetilfredshet",
    stress: "Bærekraftig arbeidsmengde og stress",
    fun: "Glede og motivasjon",
  },
  form: {
    submit: "Send inn",
    submitting: "Sender inn…",
    success: "Takk — svaret ditt ble registrert.",
    alreadySubmitted: "Du har allerede svart på denne undersøkelsen.",
    error: "Noe gikk galt. Prøv igjen.",
  },
  /**
   * Norwegian copy for `/admin/teams/[teamId]`'s survey-management section
   * (`AdminTeamDetail.tsx`'s "Undersøkelser" section, docs/features/
   * managed-surveys/SPEC.md — TASK-009). Internal/technical values
   * (`"public"`, `"authenticated"`, `"scheduled"`, `"open"`, `"closed"`) are
   * never shown — every one is mapped to plain Norwegian text here.
   */
  admin: {
    sectionTitle: "Undersøkelser",
    loading: "Laster undersøkelser…",
    error: "Noe gikk galt under lasting av undersøkelser. Prøv igjen senere.",
    empty: "Ingen undersøkelser ennå.",
    activeListTitle: "Aktive",
    archivedListTitle: "Arkiverte",
    noArchived: "Ingen arkiverte undersøkelser.",
    fallbackTitle: "Undersøkelse",
    lifecycleLabels: {
      scheduled: "Planlagt",
      open: "Pågående",
      closed: "Avsluttet",
    },
    archivedLabel: "Arkivert",
    accessModeLabels: {
      public: "Alle med lenken",
      authenticated: "Kun medlemmer av teamet",
    },
    create: {
      sectionTitle: "Opprett ny undersøkelse",
      accessModeLegend: "Hvem kan svare?",
      accessModePublicHint: "Alle som har lenken kan svare anonymt uten å logge inn.",
      accessModeAuthenticatedHint: "Deltakeren må logge inn og være medlem av teamet.",
      titleLabel: "Tittel (valgfritt)",
      minimumResponsesLabel: "Minste antall svar",
      minimumResponsesHint: "Resultater vises først når minst dette antallet personer har svart.",
      startAtLabel: "Start (valgfritt)",
      endAtLabel: "Slutt (valgfritt)",
      submit: "Opprett undersøkelse",
      submitting: "Oppretter…",
      error: "Noe gikk galt under opprettelsen av undersøkelsen. Prøv igjen.",
    },
    /** e.g. "Minst 5 svar" — the configured threshold is not sensitive (docs/features/managed-surveys/SPEC.md — "Per-survey result threshold"). */
    minimumResponsesSummary: (minimumResponses: number) => `Minst ${minimumResponses} svar`,
    linkLabel: "Lenke:",
    copyLinkButton: "Kopier lenke",
    linkCopied: "Lenke kopiert",
    openButton: "Åpne",
    openingButton: "Åpner…",
    openError: "Kunne ikke åpne undersøkelsen. Prøv igjen.",
    closeButton: "Steng",
    closingButton: "Stenger…",
    closeError: "Kunne ikke stenge undersøkelsen. Prøv igjen.",
    removeButton: "Slett/arkiver",
    removingButton: "Fjerner…",
    removeError: "Kunne ikke fjerne undersøkelsen. Prøv igjen.",
    removeConfirmPrompt:
      "Er du sikker? Undersøkelsen slettes permanent hvis den ikke har svar, ellers arkiveres den i stedet.",
    removeConfirmButton: "Bekreft fjerning",
    removeCancelButton: "Avbryt",
  },
  /**
   * Norwegian copy for `/teams/[teamId]`'s "Pågående undersøkelse" section
   * (`TeamDetail.tsx`, docs/features/managed-surveys/SPEC.md — TASK-010,
   * BR-30/BR-31). Lifecycle (`"scheduled"`/`"open"`) and access-mode labels
   * are deliberately shared with `admin.lifecycleLabels`/
   * `admin.accessModeLabels` rather than duplicated — the same Norwegian
   * term means the same thing to a team member as to an admin.
   */
  teamCurrent: {
    sectionTitle: "Pågående undersøkelse",
    error: "Noe gikk galt under lasting av undersøkelsen. Prøv igjen senere.",
    empty: "Ingen pågående undersøkelse.",
    fallbackTitle: "Undersøkelse",
    answerLink: "Svar på undersøkelsen",
    startAtLabel: "Start:",
    endAtLabel: "Slutt:",
  },
} as const;

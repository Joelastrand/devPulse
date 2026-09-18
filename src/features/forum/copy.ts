/**
 * Norwegian user-facing copy for `/teams/[teamId]`'s "Forum" section and the
 * thread-detail view (docs/features/team-forum/SPEC.md — BR-41). Internal/
 * technical values (`isDeleted`, raw ISO timestamps) are never shown to a
 * user — every surface uses the labels below. Solely responsible for any
 * prefix/framing text around `authorTag` (e.g. "Medlem {authorTag}") — the
 * server returns the bare tag string only.
 */
export const forumCopy = {
  section: {
    title: "Forum",
    loading: "Laster tråder…",
    empty: "Ingen tråder ennå.",
    error: "Noe gikk galt under lasting av forumet. Prøv igjen senere.",
    startThread: "Start en ny tråd",
  },
  authorTagLabel: (authorTag: string) => `Medlem ${authorTag}`,
  createThread: {
    heading: "Start en ny tråd",
    titleLabel: "Tittel",
    titlePlaceholder: "Kort tittel på tråden…",
    bodyLabel: "Innhold",
    bodyPlaceholder: "Beskriv temaet…",
    validationError: "Skriv en tittel på 3–150 tegn og et innhold på 3–4000 tegn.",
    submit: "Opprett tråd",
    submitting: "Oppretter…",
    success: "Tråden ble opprettet — du blir sendt til den nå.",
    teamDisabledError: "Dette teamet er for øyeblikket deaktivert og tar ikke imot nye tråder.",
    genericError: "Noe gikk galt da tråden skulle opprettes. Prøv igjen.",
  },
  detail: {
    loading: "Laster tråd…",
    notFound: "Fant ikke tråden. Den kan være slettet, eller du har ikke tilgang.",
    error: "Noe gikk galt under lasting av tråden. Prøv igjen senere.",
    signedOutMessage: "Du må logge inn for å se denne tråden.",
    signInLink: "Logg inn",
    repliesHeading: "Svar",
    noReplies: "Ingen svar ennå.",
    deletedReplyPlaceholder: "Innlegget er fjernet.",
    backToList: "Tilbake til forumet",
  },
  replyForm: {
    heading: "Svar på tråden",
    bodyLabel: "Svar",
    bodyPlaceholder: "Skriv et svar…",
    validationError: "Skriv et svar på 3–2000 tegn.",
    submit: "Send svar",
    submitting: "Sender…",
    success: "Svaret ditt ble lagt til.",
    replyAgain: "Skriv et nytt svar",
    threadFull: "Denne tråden har nådd maksgrensen på 500 svar og tar ikke imot flere.",
    genericError: "Noe gikk galt under innsendingen. Prøv igjen.",
  },
  deleteThread: {
    button: "Slett tråd",
    deleting: "Sletter…",
    confirmPrompt:
      "Er du sikker? Tråden og alle svarene slettes permanent og kan ikke gjenopprettes.",
    confirmButton: "Bekreft sletting",
    cancelButton: "Avbryt",
    error: "Kunne ikke slette tråden. Prøv igjen.",
  },
  deleteReply: {
    button: "Slett svar",
    deleting: "Sletter…",
    confirmPrompt: "Er du sikker? Svaret slettes permanent og kan ikke gjenopprettes.",
    confirmButton: "Bekreft sletting",
    cancelButton: "Avbryt",
    error: "Kunne ikke slette svaret. Prøv igjen.",
  },
} as const;

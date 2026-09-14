/**
 * Norwegian user-facing copy for `/teams/[teamId]`'s "Utfordringer" section
 * (`ChallengeSubmissionPanel`, `ChallengeList`), per the copy-module
 * convention established in `docs/features/product-ux-shell/SPEC.md` BR-2.
 * Internal/technical status values (`"open"`, `"resolved"`) are never shown
 * to a user — every surface uses the Norwegian labels below (BR-29).
 *
 * The submission panel's anonymity copy states the guarantee exactly as
 * strongly as the architecture supports (docs/features/
 * anonymous-challenges/SPEC.md — "Privacy/anonymity model": *never who*, not
 * *never what*) and explicitly warns against including identifying details
 * (BR-28) — it must never be strengthened beyond this wording without a
 * corresponding SPEC change. The admin-only management section's copy is
 * appended below, under `challengesCopy.admin` (TASK-006) — including
 * `archivedLabel`, the one status label TASK-005 didn't need.
 */
export const challengesCopy = {
  submission: {
    heading: "Meld en utfordring",
    explanation:
      "Del noe som gjør arbeidet vanskeligere, skaper friksjon, eller bør bli bedre. Innsendingen er anonym — vi lagrer ikke hvem som sendte den inn.",
    identityWarning: "Ikke inkluder navn eller annen informasjon som kan identifisere deg eller andre.",
    textareaLabel: "Utfordring",
    textareaPlaceholder: "Beskriv utfordringen…",
    validationError: "Skriv inn mellom 3 og 2000 tegn.",
    submit: "Send inn",
    submitting: "Sender inn…",
    success: "Takk — utfordringen din ble registrert.",
    teamDisabledError: "Dette teamet er for øyeblikket deaktivert og tar ikke imot nye utfordringer.",
    genericError: "Noe gikk galt under innsendingen. Prøv igjen.",
  },
  list: {
    sectionTitle: "Utfordringer",
    loading: "Laster utfordringer…",
    empty: "Ingen utfordringer ennå.",
    error: "Noe gikk galt under lasting av utfordringer. Prøv igjen senere.",
    statusLabels: {
      open: "Åpen",
      resolved: "Løst",
    },
  },
  /**
   * Norwegian copy for `/admin/teams/[teamId]`'s "Utfordringer" management
   * section (`AdminChallengeList.tsx`, docs/features/anonymous-challenges/
   * SPEC.md — TASK-006, BR-29, BR-30). Internal/technical status values
   * (`"open"`, `"resolved"`, `"archived"`) are never shown — every surface
   * uses the Norwegian labels below. Lifecycle action labels/errors mirror
   * `surveysCopy.admin`'s exact shape and destructive-confirmation pattern.
   */
  admin: {
    sectionTitle: "Utfordringer",
    loading: "Laster utfordringer…",
    error: "Noe gikk galt under lasting av utfordringer. Prøv igjen senere.",
    empty: "Ingen utfordringer ennå.",
    activeListTitle: "Aktive",
    archivedListTitle: "Arkiverte",
    noArchived: "Ingen arkiverte utfordringer.",
    statusLabels: {
      open: "Åpen",
      resolved: "Løst",
      archived: "Arkivert",
    },
    resolveButton: "Marker som løst",
    resolvingButton: "Markerer…",
    resolveError: "Kunne ikke markere utfordringen som løst. Prøv igjen.",
    archiveButton: "Arkiver",
    archivingButton: "Arkiverer…",
    archiveError: "Kunne ikke arkivere utfordringen. Prøv igjen.",
    deleteButton: "Slett",
    deletingButton: "Sletter…",
    deleteError: "Kunne ikke slette utfordringen. Prøv igjen.",
    deleteConfirmPrompt: "Er du sikker? Utfordringen slettes permanent og kan ikke gjenopprettes.",
    deleteConfirmButton: "Bekreft sletting",
    deleteCancelButton: "Avbryt",
  },
} as const;

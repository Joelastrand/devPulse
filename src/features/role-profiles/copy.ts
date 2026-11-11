/** Norwegian UI copy for organizational roles. Draft wording needs copy review before release (SPEC "Navigation and UX"). */
export const adminRolesCopy = {
  /** Visual-redesign TASK-015: split view on large screens (role list left, selected role right). */
  splitListLabel: "Roller",
  pageTitle: "Roller",
  pageDescription: "Organisatoriske roller med tittel og beskrivelse. Tildel roller til personer i teamene.",
  notice: "Ikke registrer personnavn eller personlige opplysninger i rollebeskrivelser.",
  loading: "Laster roller…",
  empty: "Ingen roller er lagt inn ennå.",
  statusActive: "Aktiv",
  statusArchived: "Arkivert",
  forbidden: "Du har ikke tilgang til denne siden.",
  readFailed: "Rollene kunne ikke lastes. Prøv igjen senere.",
  signInPrompt: "Du må",
  signInLink: "logge inn",
  signInSuffix: "for å fortsette.",
  newRole: "Ny rolle",
  editRole: "Rediger",
  archiveRole: "Arkiver",
  restoreRole: "Gjenopprett",
  cancel: "Avbryt",
  save: "Lagre",
  saving: "Lagrer…",
  form: {
    createHeading: "Ny rolle",
    editHeading: (name: string) => `Rediger ${name}`,
    nameLabel: "Tittel",
    nameHint: "1 til 80 tegn.",
    descriptionLabel: "Beskrivelse",
    descriptionHint: "Påkrevd. Høyst 500 tegn.",
    nameError: "Tittelen må være mellom 1 og 80 tegn.",
    descriptionError: "Beskrivelsen er påkrevd og kan være høyst 500 tegn.",
  },
  errors: {
    invalid_input: "Kontroller feltene og prøv igjen.",
    invalid_request: "Kontroller feltene og prøv igjen.",
    not_found: "Rollen finnes ikke lenger.",
    role_archived: "Rollen er arkivert og kan ikke redigeres før den gjenopprettes.",
    cap_reached: "Det er nådd maksimalt antall roller.",
    unauthenticated: "Du må logge inn på nytt.",
    forbidden: "Du har ikke tilgang til denne siden.",
    persistence_failed: "Noe gikk galt. Prøv igjen.",
  },
} as const;

/** The user-facing text for a server error code. Unknown codes get the neutral failure text. */
export function roleErrorMessage(error: string): string {
  const messages: Record<string, string> = adminRolesCopy.errors;
  return messages[error] ?? adminRolesCopy.errors.persistence_failed;
}

/** Norwegian UI copy for the formal role assignment (admin team view and the person's role section). */
export const roleAssignmentCopy = {
  sectionTitle: "Organisatoriske roller",
  sectionDescription: "Tildel hver person én organisatorisk rolle. Rollen gir ingen tilgang i DevPulse.",
  heading: "Organisatorisk rolle",
  none: "Ingen rolle tildelt",
  assign: "Tildel rolle",
  change: "Endre rolle",
  remove: "Fjern rolle",
  select: "Velg rolle",
  saving: "Lagrer…",
  removing: "Fjerner…",
  archivedRole: "Tildelt rolle er arkivert",
  selfAssignment: "Du kan ikke endre din egen rolle.",
  saved: "Rollen er lagret.",
  removed: "Rollen er fjernet.",
  lookupFailed: "Rolletildelingene kunne ikke lastes. Prøv igjen.",
  loading: "Laster rolletildelinger…",
  errors: {
    invalid_input: "Velg en gyldig rolle og prøv igjen.",
    role_not_found: "Rollen finnes ikke lenger. Oppdater siden og prøv igjen.",
    role_archived: "Rollen er arkivert og kan ikke tildeles. Velg en aktiv rolle.",
    self_assignment: "Du kan ikke endre din egen rolle.",
    erasure_in_progress: "Kontoen er under sletting, og rollen kan ikke endres.",
    unauthenticated: "Du må logge inn på nytt.",
    forbidden: "Du har ikke tilgang til denne handlingen.",
    persistence_failed: "Noe gikk galt. Prøv igjen.",
  },
} as const;

/** Text for a failed assignment call. Unknown codes get the neutral failure text. */
export function roleAssignmentErrorMessage(error: string): string {
  const messages: Record<string, string> = roleAssignmentCopy.errors;
  return messages[error] ?? roleAssignmentCopy.errors.persistence_failed;
}

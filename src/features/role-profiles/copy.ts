/** Norwegian UI copy for role profiles. Draft wording marked in SPEC "Navigation and UX" needs copy review before release. */
export const adminRolesCopy = {
  pageTitle: "Roller",
  pageDescription: "Roller beskriver forventninger til kompetanseområder. De brukes til sammenligning for den enkelte.",
  notice: "Ikke registrer personnavn eller personlige opplysninger i rollebeskrivelser.",
  loading: "Laster roller…",
  empty: "Ingen roller er lagt inn ennå.",
  noExpectations: "Rollen har ingen forventninger ennå.",
  expectationsLabel: "Forventninger",
  expectedLevel: (level: number) => `Forventet nivå ${level}`,
  unavailableArea: "Ikke tilgjengelig",
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
    nameLabel: "Navn",
    nameHint: "1 til 80 tegn.",
    descriptionLabel: "Beskrivelse (valgfri)",
    descriptionHint: "Høyst 500 tegn. Tom beskrivelse fjerner den.",
    addExpectation: "Legg til forventning",
    removeExpectation: "Fjern",
    areaLabel: "Kompetanseområde",
    levelLabel: "Forventet nivå",
    chooseArea: "Velg kompetanseområde",
    noCatalog: "Kompetanseområdene kunne ikke lastes. Du kan ikke lagre forventninger nå.",
    nameError: "Navnet må være mellom 1 og 80 tegn.",
    descriptionError: "Beskrivelsen kan være høyst 500 tegn.",
    expectationsError: "Velg hvert kompetanseområde høyst én gang, og et nivå fra 2 til 4.",
    expectationLimit: "En rolle kan ha høyst 20 forventninger.",
  },
  errors: {
    invalid_input: "Kontroller feltene og prøv igjen.",
    invalid_request: "Kontroller feltene og prøv igjen.",
    not_found: "Rollen finnes ikke lenger.",
    role_archived: "Rollen er arkivert og kan ikke redigeres før den gjenopprettes.",
    skill_not_found: "Et kompetanseområde finnes ikke lenger. Oppdater siden og prøv igjen.",
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

/** Norwegian UI copy for the person's role section on `/me/skills` (PG-2, PG-3). Draft wording needs copy review. */
export const personRoleCopy = {
  sectionHeading: "Rolleforventninger",
  sectionDescription: "Velg en rolle du vil utvikle mot. Sammenligningen er bare synlig for deg.",
  noTarget: "Ingen rolle valgt",
  chooseRole: "Rolle å utvikle mot",
  selectPlaceholder: "Velg en rolle",
  selectRole: "Velg rolle",
  changeRole: "Endre rolle",
  clearRole: "Fjern valgt rolle",
  cancel: "Avbryt",
  archived: "Rollen er arkivert",
  unavailable: "Valgt rolle kan ikke brukes til sammenligning nå.",
  noExpectations: "Rollen har ingen forventninger ennå.",
  noRoles: "Ingen roller er lagt inn ennå.",
  loading: "Laster rolleforventninger…",
  readFailed: "Rolleforventningene kunne ikke lastes. Prøv igjen senere.",
  signInPrompt: "Du må",
  signInLink: "logge inn",
  signInSuffix: "for å se rolleforventningene dine.",
  comparison: {
    privacyNotice:
      "Valgt rolle og sammenligningen er bare synlige for deg. Rollen sier noe om forventninger til en rolle, ikke om deg som person, og brukes ikke i vurdering, lønn eller tildeling av oppgaver.",
    meets: "Møter forventningen",
    developmentOpportunity: "Utviklingsmulighet",
    notAssessed: "Ikke vurdert ennå",
    unavailable: "Ikke tilgjengelig",
    areaUnavailable: "Kompetanseområdet er ikke tilgjengelig",
    expectedLevel: (level: number) => `Forventet nivå ${level}`,
    ownLevel: (level: number) => `Ditt nivå ${level}`,
    readFailed: "Sammenligningen kunne ikke vises nå. Prøv igjen senere.",
    createGoal: "Opprett mål",
  },
  errors: {
    not_found: "Rollen finnes ikke lenger. Velg en annen rolle.",
    role_not_selectable: "Rollen kan ikke velges nå. Den er arkivert eller mangler gyldige forventninger.",
    invalid_request: "Velg en rolle og prøv igjen.",
    unauthenticated: "Du må logge inn på nytt.",
    persistence_failed: "Noe gikk galt. Prøv igjen.",
  },
} as const;

/** The user-facing text for a selection or clear failure. Unknown codes get the neutral failure text. */
export function targetErrorMessage(error: string): string {
  const messages: Record<string, string> = personRoleCopy.errors;
  return messages[error] ?? personRoleCopy.errors.persistence_failed;
}

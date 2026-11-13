/** Norwegian copy for superadmin user management. Error codes map to fixed messages; raw codes or Firebase text never reach the screen. */
export const userManagementCopy = {
  sectionTitle: "Brukere",
  sectionDescription:
    "Søk etter konto med e-postadresse, se verifisering, status og teamtilhørighet, og deaktiver eller aktiver kontoer. Sletting av en konto skjer alltid av personen selv gjennom kontosletting.",
  searchLabel: "Søk etter e-postadresse",
  searchSubmit: "Søk",
  listLoading: "Laster brukere…",
  listEmpty: "Ingen brukere å vise.",
  nextPage: "Neste side",
  view: "Vis",
  verified: "E-post bekreftet",
  notVerified: "E-post ikke bekreftet",
  enabled: "Aktiv",
  disabled: "Deaktivert",
  createdAt: "Opprettet",
  lastSignInAt: "Sist innlogget",
  never: "Aldri",
  noAddress: "Ingen e-postadresse",
  teams: "Team",
  noTeams: "Ingen teamtilhørighet",
  teamadmin: "teamadmin",
  member: "medlem",
  disable: "Deaktiver konto",
  confirmDisableTitle: "Deaktivere kontoen?",
  confirmDisableBody:
    "Personen mister tilgang straks. Eksisterende innlogginger avsluttes ved neste forespørsel. Kontoen kan aktiveres igjen senere.",
  confirmDisable: "Bekreft deaktivering",
  cancel: "Avbryt",
  enable: "Aktiver konto på nytt",
  disabledOk: "Kontoen er deaktivert, og eksisterende innlogginger er avsluttet.",
  enabledOk: "Kontoen er aktivert igjen.",
  working: "Lagrer…",
} as const;

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "Du har ikke tilgang til brukeradministrasjon.",
  unauthenticated: "Du må logge inn på nytt for å fortsette.",
  auth_unavailable: "Tjenesten er midlertidig utilgjengelig. Prøv igjen om litt.",
  invalid_input: "Søket eller valget er ugyldig.",
  user_not_found: "Fant ingen konto.",
  self_action_refused: "Du kan ikke deaktivere din egen konto.",
  target_is_superadmin: "Kontoen er superadministrator. Fjern administratortilgangen først.",
  confirmation_required: "Bekreft deaktiveringen før den gjennomføres.",
  read_failed: "Brukerlisten kunne ikke hentes. Prøv igjen.",
  persistence_failed: "Endringen kunne ikke lagres. Prøv igjen.",
};

export function userManagementErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.persistence_failed;
}

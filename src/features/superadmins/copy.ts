/** Norwegian UI copy for `/admin/superadmins`. Error copy is keyed by the server's fixed error codes, never by server detail. */
export const superadminsCopy = {
  pageTitle: "Superadministratorer",
  pageDescription:
    "Superadministratorer kan administrere teamkompetanse og andre administrative oppgaver på tvers av DevPulse. Tilgangen gis og fjernes her.",
  listHeading: "Aktive superadministratorer",
  listLoading: "Laster superadministratorer …",
  listEmpty: "Ingen aktive superadministratorer.",
  listReadFailed: "Superadministratorene kunne ikke lastes. Prøv igjen.",
  grantedAt: "Gitt",
  grantedAtUnknown: "ukjent",
  addHeading: "Legg til superadministrator",
  addDescription:
    "Brukeren må allerede ha en konto i Firebase Authentication med bekreftet e-postadresse. Det opprettes ingen nye kontoer her.",
  emailLabel: "E-postadresse",
  addSubmit: "Legg til",
  addPending: "Legger til …",
  addSuccess: "Brukeren er nå superadministrator.",
  addAlreadySuperadmin: "Brukeren er allerede superadministrator.",
  revokeButton: "Fjern tilgang",
  revokeConfirmTitle: "Fjerne superadministrator?",
  revokeConfirmBody:
    "Brukeren mister superadministrator-tilgang med en gang. Dette kan rettes ved å legge til brukeren på nytt.",
  revokeConfirmSubmit: "Ja, fjern tilgang",
  revokeConfirmPending: "Fjerner …",
  revokeCancel: "Avbryt",
  revokeSuccess: "Superadministratoren er fjernet.",
  errors: {
    invalid_input: "Skriv inn en gyldig e-postadresse.",
    target_not_found: "Fant ingen konto med denne e-postadressen. Brukeren må registrere seg først.",
    target_unverified: "Kontoen må ha bekreftet e-postadresse før den kan bli superadministrator.",
    target_disabled: "Kontoen er deaktivert og kan ikke bli superadministrator.",
    forbidden: "Du har ikke tilgang til å administrere superadministratorer.",
    last_superadmin: "Den siste aktive superadministratoren kan ikke fjernes. Legg til en annen først.",
    not_superadmin: "Brukeren er ikke lenger superadministrator. Oppdater listen.",
    erasure_in_progress: "Kontoen er under sletting og kan ikke endres.",
    unauthenticated: "Du må logge inn på nytt.",
    auth_unavailable: "Innloggingstjenesten er ikke tilgjengelig akkurat nå. Prøv igjen.",
    persistence_failed: "Noe gikk galt. Prøv igjen.",
    read_failed: "Noe gikk galt. Prøv igjen.",
  },
} as const;

export type SuperadminErrorCode = keyof typeof superadminsCopy.errors;

/** The copy for a server error code. Unknown codes get the generic message, never the raw code. */
export function superadminErrorMessage(error: string): string {
  return Object.prototype.hasOwnProperty.call(superadminsCopy.errors, error)
    ? superadminsCopy.errors[error as SuperadminErrorCode]
    : superadminsCopy.errors.persistence_failed;
}

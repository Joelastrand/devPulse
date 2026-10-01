/**
 * Norwegian copy for the "Min profil" page (docs/features/member-identity-
 * and-team-roles/SPEC.md — BR-30, BR-33). Validation wording deliberately
 * avoids implementation terms; the detailed rules live only in the server
 * domain (`display-name.ts`).
 */
export const profileCopy = {
  pageTitle: "Min profil",
  pageDescription: "Velg hvordan du vises for andre i teamene dine.",
  loading: "Laster profilen din…",
  signInLink: "Logg inn",
  signInPrompt: "for å se og endre profilen din.",
  loadError: "Noe gikk galt under lasting av profilen din.",
  retryButton: "Prøv igjen",
  fieldLabel: "Visningsnavn",
  fieldDescription:
    "Mellom 2 og 50 tegn. Navnet vises for andre medlemmer i team du tilhører, og for administratorer. Andre medlemmer ser ikke e-postadressen din. Navnet trenger ikke å være unikt, og du kan endre eller fjerne det når som helst.",
  currentNamePrefix: "Nåværende visningsnavn:",
  noName: "Du har ikke satt et visningsnavn. Andre medlemmer ser da «Medlem uten navn».",
  saveButton: "Lagre",
  savingButton: "Lagrer…",
  removeButton: "Fjern visningsnavn",
  removingButton: "Fjerner…",
  removeHint: "Dette fjerner bare visningsnavnet ditt. Kontoen din og teammedlemskapene dine påvirkes ikke.",
  saved: "Visningsnavnet er lagret.",
  removed: "Visningsnavnet er fjernet.",
  emptyName: "Skriv inn et visningsnavn.",
  invalidName:
    "Visningsnavnet er ikke gyldig. Bruk 2–50 tegn med minst én bokstav eller ett tall, uten linjeskift eller skjulte tegn.",
  signInAgain: "Du må logge inn på nytt.",
  genericError: "Noe gikk galt. Prøv igjen.",
} as const;

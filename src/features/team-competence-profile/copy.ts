/**
 * Norwegian UI strings for the Kompetanseprofil radar and the team settings section. Strings are kept in one module so
 * the label set is consistent (Amendment A §A.6). No string claims anonymity, and none states a count of members.
 */
export const KOMPETANSEPROFIL_COPY = {
  title: "Kompetanseprofil",
  legendTeam: "Teamets nivå",
  legendTarget: "Forventet nivå",
  tableCaption: "Kompetanseprofil per område",
  columnArea: "Kompetanseområde",
  columnTeam: "Teamets nivå",
  columnTarget: "Forventet nivå",
  unset: "Ikke satt",
  noTarget: "Ikke angitt",
  tooFew: "Legg til minst tre kompetanseområder for å se kompetanseprofilen.",
  tooMany: "Profilen vises for opptil åtte områder. Se tabellen for alle områder.",
  empty: "Ingen nivåer er satt ennå.",
  invalid: "Kompetanseprofilen kan ikke vises akkurat nå.",
  summary: (setCount: number, total: number) => `Teamets nivå er satt for ${setCount} av ${total} områder.`,
} as const;

export const PROFILE_MODE_COPY = {
  automatic: {
    label: "Automatisk kompetanseprofil",
    description:
      "Teamprofilen beregnes fra medlemmenes delte egenvurderinger. Et område vises først når minst tre bidragsytere har vurdert det.",
  },
  collaborative: {
    label: "Felles kompetanseprofil",
    description:
      "Teamadmin registrerer en felles vurdering av teamets nivå per område. Verdiene hentes ikke fra medlemmenes vurderinger.",
  },
} as const;

export const TEAM_SETTINGS_COPY = {
  pageTitle: "Innstillinger",
  profileHeading: "Kompetanseprofil",
  profileIntro: "Velg hvordan teamets kompetanseprofil skal bygges.",
  defaultBadge: "Standard",
  modeDoesNotChangeSharing: "Endring av modus endrer ikke noen medlems deling.",
  modeReadOnly: "Bare teamadmin kan endre modus.",
  modeSave: "Lagre modus",
  modeSaved: "Modus er lagret.",
  loading: "Laster innstillingene…",
  readFailed: "Innstillingene kan ikke lastes akkurat nå. Prøv igjen senere.",
  forbidden: "Du har ikke tilgang til teamets innstillinger.",
  saveFailed: "Modus kunne ikke lagres. Prøv igjen.",
} as const;

/** Teamkompetanse collaborative panel: levels, area management and their states. Norwegian copy review is gate G4. */
export const COLLABORATIVE_PANEL_COPY = {
  levelsHeading: "Felles nivå per område",
  levelsIntro:
    "Teamadmin setter nivået for hvert aktive område manuelt. Verdiene påvirkes ikke av medlemmenes egne vurderinger.",
  levelUnset: "Ikke satt",
  levelLabel: (area: string) => `Felles nivå for ${area}`,
  levelSave: "Lagre nivå",
  areasHeading: "Kompetanseområder",
  areasIntro: "Områdene teamet arbeider med. Inaktive og arkiverte områder vises ikke i radaren.",
  statusLabel: (area: string) => `Status for ${area}`,
  areaSave: "Lagre status",
  catalogUnavailable: "Listen over tilgjengelige områder kan ikke lastes akkurat nå.",
  statusActive: "Aktivt",
  statusInactive: "Inaktivt",
  statusArchived: "Arkivert",
  addHeading: "Legg til område",
  addLabel: "Velg kompetanseområde",
  addButton: "Legg til",
  addNone: "Alle tilgjengelige områder er allerede lagt til.",
  unnamedArea: "Område ikke tilgjengelig",
  emptyAreas: "Teamet har ingen kompetanseområder ennå.",
  automaticHint: "Automatisk modus er valgt. Teamadmin kan bytte modus under Innstillinger.",
  radarEmpty: "Sett felles nivå for minst ett aktivt område for å se radaren.",
  keyFiguresHeading: "Nøkkeltall",
  areasSetLabel: (set: number, total: number) => `${set} av ${total}`,
  areasSetDescription: "aktive områder med felles nivå",
  averageLabel: (value: string) => `${value} / 4`,
  averageDescription: "gjennomsnittlig felles nivå",
  perAreaHeading: "Kompetanse per område",
  perAreaColumnArea: "Kompetanseområde",
  perAreaColumnLevel: "Felles nivå",
  perAreaUnset: "Ikke satt",
  perAreaLevel: (level: number) => `${level} av 4`,
  saved: "Endringen er lagret.",
  saveFailed: "Endringen kunne ikke lagres. Prøv igjen.",
  conflict: "Endringen står i konflikt med gjeldende tilstand. Last siden på nytt.",
  readFailed: "Teamkompetansen kan ikke lastes akkurat nå. Prøv igjen senere.",
  forbidden: "Du har ikke tilgang til teamets kompetanse.",
  loading: "Laster teamkompetansen…",
  unauthenticated: "Logg inn for å se teamkompetansen.",
} as const;

/**
 * States of the Teamkompetanse radar panel. Every non-value state is written as an honest outcome: a missing value is never
 * drawn as zero, and a refusal never reveals whether the team has data. Pending Norwegian copy review (Amendment A gate G4).
 */
export const TEAM_PROFILE_STATE_COPY = {
  loading: "Laster kompetanseprofilen…",
  signedOut: "Logg inn for å se teamets kompetanseprofil.",
  forbidden: "Du har ikke tilgang til teamets kompetanseprofil.",
  teamDisabled: "Teamet er ikke aktivt, så kompetanseprofilen vises ikke.",
  readFailed: "Kompetanseprofilen kan ikke lastes akkurat nå. Prøv igjen senere.",
  incomplete: "Kompetanseprofilen kan ikke beregnes for teamet akkurat nå.",
  retry: "Prøv igjen",
} as const;

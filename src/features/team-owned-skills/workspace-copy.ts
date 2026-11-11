/**
 * Norwegian UI copy for the unified Teamkompetanse page (unified team competence decision, 2026-11-11). One team-owned
 * competence catalog and two ways of producing the team's profile: the automatic profile (from shared individual
 * assessments) and the collaborative profile (the team's agreed level). The Kompetanseplan is a separate feature.
 */
export const teamCompetenceCopy = {
  heading: "Teamkompetanse",
  intro: "Teamets kompetanseområder, og to måter å vise teamets nivå på.",
  modeLabel: "Visningsmodus",
  modes: {
    automatic: "Automatisk profil",
    collaborative: "Felles vurdering",
  },
  modeDescriptions: {
    automatic:
      "Beregnet fra vurderinger som medlemmer har valgt å dele. Et område vises først når minst 3 medlemmer har delt en vurdering der. Individuelle vurderinger vises aldri.",
    collaborative:
      "Nivåene teamet er blitt enige om i fellesskap, registrert av en teamadministrator. Dette er ikke en sammenstilling av individuelle vurderinger.",
  },
  activeMode: (mode: string) => `Viser: ${mode}`,
  loading: "Laster teamkompetanse…",
  empty: "Ingen aktive kompetanseområder ennå.",
  insufficient: "Ikke nok data ennå",
  notAssessed: "Ikke vurdert",
  agreedLevel: (level: number, name: string) => `Nivå ${level}: ${name}`,
  outdated: "Gjelder eldre kriterier",
  radarTooFew: "Radaren vises når minst tre områder har nok data.",
  listCaption: "Kompetansenivåer i visningen",
  columns: {
    area: "Kompetanseområde",
    level: "Nivå",
  },
  errors: {
    unauthenticated: "Logg inn for å se teamkompetansen.",
    forbidden: "Du har ikke tilgang til teamkompetansen.",
    team_disabled: "Teamet er ikke aktivt.",
    read_failed: "Teamkompetansen kan ikke lastes akkurat nå.",
    incomplete: "Statusen kan ikke beregnes for dette teamet akkurat nå.",
  },
  editor: {
    heading: "Felles vurdering: registrer teamets nivå",
    description: "Velg nivået teamet er enige om, eller fjern den felles vurderingen. Individuelle vurderinger endres ikke.",
    level: "Avtalt nivå",
    none: "Ikke vurdert",
    note: "Merknad",
    save: "Lagre",
    clear: "Fjern felles vurdering",
    saved: "Lagret.",
    failed: "Kunne ikke lagre. Prøv igjen.",
    cleared: "Fjernet.",
  },
  admin: {
    heading: "Administrer kompetanseområder",
    description: "Teamets kompetanseområder brukes både i den automatiske profilen og i den felles vurderingen.",
  },
} as const;

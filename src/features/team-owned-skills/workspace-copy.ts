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
  areaSelector: {
    legend: "Velg områder i radaren",
    help: (max: number) =>
      `Radaren og søylediagrammet viser opptil ${max} valgte områder. Velg hvilke som vises. Tabellen viser alle områder.`,
    limitReached: "Radaren viser åtte områder. Fjern ett område for å velge et annet.",
    summaryAction: "Velg kompetanseområder",
    summaryCount: (selected: number, total: number) => `${selected} av ${total} områder valgt`,
    reset: "Tilbakestill utvalg",
  },
  levelChart: {
    title: "Nivå per område",
    description: "Søylene viser teamets nivå for hvert område der nivå er beregnet. Tallet ved hver søyle er nivået.",
    label: "Teamets nivå per kompetanseområde",
    sortLabel: "Sorter",
    sort: {
      name: "Navn",
      levelDesc: "Høyest nivå",
      levelAsc: "Lavest nivå",
    },
    /** Missing levels are listed last in every sort order and are never treated as zero. */
    sortHint: "Områder uten beregnet nivå vises sist.",
    viewLabel: "Visning",
    view: {
      chart: "Stolpediagram",
      table: "Tabell",
    },
    showAll: (total: number) => `Vis alle områder (${total})`,
    showSelected: "Vis valgte områder",
    chartLimited: (shown: number, total: number) =>
      `Søylediagrammet viser ${shown} av ${total} områder. Tabellen viser alle områder.`,
  },
  summary: {
    label: "Oppsummering",
    withData: (count: number, total: number) => `${count} av ${total} områder har nivå`,
    highest: (name: string, level: number) => `Høyest: ${name} (nivå ${level})`,
    lowest: (name: string, level: number) => `Lavest: ${name} (nivå ${level})`,
    tied: (count: number) => (count === 2 ? "og ett annet område" : `og ${count - 1} andre områder`),
    noData: "Ingen områder har beregnet nivå ennå.",
  },
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
  simulatedNotice:
    "Denne visningen inneholder simulerte demodata for fiktive teammedlemmer. Det er ikke ekte samtykke fra ansatte, og tallene skal ikke tolkes som ekte kompetanse.",
  editor: {
    heading: "Felles vurdering: registrer teamets nivå",
    description: "Velg nivået teamet er enige om, eller fjern den felles vurderingen. Individuelle vurderinger endres ikke.",
    level: "Avtalt nivå",
    none: "Ikke vurdert",
    note: "Merknad",
    save: "Lagre",
    saving: "Lagrer …",
    clear: "Fjern felles vurdering",
    saved: "Lagret.",
    failed: "Kunne ikke lagre. Prøv igjen.",
    denied: "Du har ikke tilgang til å endre teamkompetansen.",
    cleared: "Fjernet.",
  },
  admin: {
    heading: "Administrer kompetanseområder",
    description: "Teamets kompetanseområder brukes både i den automatiske profilen og i den felles vurderingen.",
  },
} as const;

import type { SelfAssessedLevel } from "./domain/self-assessed-level";

/**
 * Norwegian copy for the personal skills page (docs/archive/features/individual-skill-
 * self-assessment/SPEC.md — BR-4, BR-5, BR-25, BR-26, BR-30). Level names and
 * descriptions are wording only: the canonical meaning of each level lives in
 * `domain/self-assessed-level.ts` and may not change here. No numeric "x av 4"
 * display, no seniority wording, and no promise that the data is never used
 * elsewhere (BR-5). The privacy notice was amended by team-skill-needs-and-matrix BR-29 (TASK-011).
 */
/** Dashboard labels for `/me/skills` (ref 07). Counts only; the rule behind each count is stated in its detail text. */
export const skillDashboardCopy = {
  summaryHeading: "Oppsummering",
  developmentLabel: "Din utvikling",
  developmentDetail: "ferdigheter på nivå 3 eller høyere",
  assessedLabel: "Vurderte ferdigheter",
  areasLabel: "Utviklingsområder",
  areasDetail: "ferdigheter på nivå 1 eller 2",
  shownDetail: "av de viste ferdighetene",
} as const;

/**
 * Route-backed views of `/me/skills` (`?vy=`). Not part of the C1 wording scan (which covers `skillProfileCopy`). The
 * "Rollesammenligning" label is the owner-approved name of the role comparison, as in the role section's own copy.
 */
export const skillViewCopy = {
  navLabel: "Visninger for ferdigheter",
  /**
   * `rediger` keeps its route value for backward compatibility (links from Samtaler, Hjem and Mål); its label is now the
   * personal skill assessment. `teamkompetanser` is the separate team competency view.
   */
  tabs: [
    { view: "oversikt", label: "Oversikt" },
    { view: "rediger", label: "Mine ferdigheter" },
    { view: "teamkompetanser", label: "Teamkompetanser" },
    { view: "rolle", label: "Min rolle og mine bidrag" },
    { view: "deling", label: "Deling med team" },
  ],
} as const;

/** Explanations of the two catalogs. Both are progressive disclosures; the privacy facts are repeated here, not invented. */
export const skillCatalogCopy = {
  personal: {
    intro: "Vurder ditt eget nivå på ferdighetene i DevPulse sin felles katalog. Vurderingene er private.",
    whatIsTitle: "Hva er mine ferdigheter?",
    whatIsBody: [
      "Ferdighetene kommer fra DevPulse sin felles kompetansekatalog. Katalogen vedlikeholdes av superadministratorer. Du kan ikke opprette nye ferdigheter selv; en ferdighet som mangler må legges til av en superadministrator.",
      "Du vurderer ditt eget nivå, fra 1 til 4. Vurderingen brukes til din egen utvikling, og et lavt nivå er ikke et krav eller et gap.",
      "Mine ferdigheter er din egen vurdering av felles ferdigheter. Kompetanser som teamet har definert, vurderer du under Teamkompetanser.",
      "Bare du kan se nivåene dine. Hvis du velger det under Deling med team, kan teamet se en grov status, aldri dine enkeltnivåer.",
    ],
    progressHeading: "Din ferdighetsprofil",
    listTitle: "Dine ferdigheter",
    listProgress: (assessed: number, total: number) => `${assessed} av ${total} vurdert`,
    listActionAll: "Vis og endre vurderinger",
    listActionPartial: "Fortsett vurderingen",
    listFailedWhileCollapsed: "En vurdering ble ikke lagret. Åpne «Dine ferdigheter» for å prøve igjen.",
  },
  team: {
    intro: "Kompetansene teamene dine har definert. Du vurderer ditt eget nivå, og vurderingene dine er private.",
    whatIsTitle: "Hva er teamkompetanser?",
    whatIsBody: [
      "Hvert team har sin egen kompetansekatalog. Den defineres og vedlikeholdes av teamets administratorer og er ikke en del av den felles katalogen for mine ferdigheter.",
      "Du vurderer ditt eget nivå på hver aktive kompetanse i teamet. Veiledningen for hvert nivå vises under kompetansen der teamet har skrevet den.",
      "Dine vurderinger er private. Teamadministratorer kan ikke se nivåene dine gjennom denne visningen.",
      "Å bidra til teamets samlede oversikt er et eget, frivillig valg. Det gjør du under Deling med team, og teamet ser da bare en grov status, aldri individuelle nivåer.",
    ],
    delingLinkLabel: "Administrer deling med team",
    summaryHeading: "Teamkompetanser",
    summaryCounts: (assessed: number, active: number) => `${assessed} av ${active} vurdert`,
    summaryNone: "Du er ikke medlem av noe team med kompetanser ennå.",
    summaryLoading: "Laster teamkompetansene dine …",
    summaryAction: "Vurder teamkompetanser",
    summaryLink: "Gå til teamkompetanser",
    nextStepHint: "Din egenvurdering er fullført. Du har teamkompetanser som ikke er vurdert ennå.",
    summaryUnavailable: "Teamkompetansene kunne ikke lastes akkurat nå.",
  },
} as const;

export const skillProfileCopy = {
  pageTitle: "Mine ferdigheter",
  pageDescription: "Din egen vurdering av hva du kan, som støtte for din egen utvikling.",
  privacyNotice:
    "Egenvurderingen din er din egen. Teamkolleger, teamledere og administratorer kan ikke se nivåene du setter. Du kan velge, team for team, at den skal telle med i en personvernbeskyttet teamoversikt der teamet bare ser en grov status per kompetansebehov.",
  loading: "Laster ferdighetene dine…",
  signInLink: "Logg inn",
  signInPrompt: "for å se ferdighetene dine.",
  loadError: "Noe gikk galt under lasting av ferdighetene dine.",
  retryButton: "Prøv igjen",
  noSkillsDefined: "Ingen ferdigheter er definert ennå.",
  noAssessmentsYet: "Du har ikke vurdert noen ferdigheter ennå. Du kan begynne når det passer for deg.",
  unreadableNotice: "Lagrede vurderinger kan ikke leses akkurat nå.",
  legendHeading: "Nivåer",
  personalHeading: "Mine ferdigheter",
  skillColumnHeading: "Ferdighet",
  personalDescription: "Din personlige vurdering av ferdigheter i den felles kompetansekatalogen.",
  searchLabel: "Søk etter ferdighet",
  searchPlaceholder: "Søk etter ferdighet",
  searchClear: "Tøm søk",
  resultCount: (shown: number, total: number) => `Viser ${shown} av ${total} ferdigheter`,
  noSearchMatches: "Ingen ferdigheter samsvarer med søket.",
  unassessed: "Ikke vurdert",
  clearRating: "Fjern vurdering",
  levelSummary: (level: number, levelName: string) => `Nivå ${level} · ${levelName}`,
  sameNameHint: (index: number, total: number) => `Kompetanseområde ${index} av ${total} med dette navnet. Vurder hvert område for seg.`,
  saving: "Lagrer…",
  saveFailed: "Vurderingen ble ikke lagret. Prøv igjen.",
  skillUnavailable: "Denne ferdigheten er ikke lenger tilgjengelig.",
  filterLegend: "Filtrer ferdigheter",
  filterAll: "Alle",
  filterAssessed: "Vurdert",
  filterUnassessed: "Ikke vurdert",
  noFilterMatches: "Ingen ferdigheter samsvarer med valgt filter.",
  truncatedNotice: "Listen kan være ufullstendig.",
  resetButton: "Nullstill alle ferdigheter",
  resettingButton: "Nullstiller…",
  resetConfirmPrompt:
    "Alle dine lagrede egenvurderinger fjernes permanent og kan ikke angres. Selve ferdighetslisten slettes ikke, og dette gjelder bare dine egne vurderinger.",
  resetConfirmLabel: "Ja, nullstill alle",
  resetCancelLabel: "Avbryt",
  resetFailed: "Egenvurderingene dine ble ikke nullstilt. Prøv igjen.",
  resetDone: "Egenvurderingene dine er nullstilt.",
  /** Oversikt (overview) copy. Scanned by the C1 wording guard like the rest of this object. */
  overview: {
    profileHeading: "Kompetanseprofil",
    profileIntro: "Ett nivå per ferdighet. Ferdigheter uten vurdering vises som ikke vurdert.",
    seeAll: "Se alle ferdigheter",
    /** The profile list is a preview of at most seven rows; the rest are in the Kompetansekart. */
    moreAreas: (count: number) => `Forhåndsvisning: ${count} flere ferdigheter vises i Kompetansekart.`,
    summaryAdvancedTitle: "Ferdigheter på nivå 3–4",
    summaryAdvancedDetail: "Ferdigheter du har vurdert til nivå 3 eller 4.",
    summaryAssessedTitle: "Vurderte ferdigheter",
    summaryAssessedValue: (assessed: number, total: number) => `${assessed} av ${total}`,
    summaryAssessedDetail: "Ferdigheter du har vurdert av de tilgjengelige.",
    summaryDevelopTitle: "Ferdigheter på nivå 1–2",
    summaryDevelopDetail: "Din egenvurdering på de to laveste nivåene. Dette er ikke et krav eller et gap.",
    nextStepsHeading: "Neste steg",
    startHint: "Du har ikke vurdert noen ferdigheter ennå. Begynn når det passer for deg.",
    startAction: "Vurder din første ferdighet",
    allAssessedHint: "Alle ferdighetene dine er vurdert. Du kan gjennomgå og endre dem når som helst.",
    unassessedHint: (count: number) => (count === 1 ? "1 ferdighet er ikke vurdert ennå." : `${count} ferdigheter er ikke vurdert ennå.`),
    assessAction: "Vurder de gjenværende i Kompetansekart",
    continueAction: "Fortsett vurderingen",
    reviewAction: "Gjennomgå og endre ferdighetene dine",
    goalsAction: "Åpne mine utviklingsmål",
    roleWorkspaceAction: "Min rolle og mine bidrag",
    viewSwitchLabel: "Visning av kompetanseprofilen",
    viewList: "Liste",
    viewRadar: "Radar",
    radarLabel: (count: number) => `Radardiagram over ${count} vurderte ferdigheter, nivå 1 til 4.`,
    radarLegend: "Din vurdering",
    radarTableCaption: "Nivå per vurdert ferdighet",
    radarOmitted: (count: number) => `${count} vurderte ferdigheter vises bare i listen.`,
    radarUnassessedNote: (count: number) => `${count} ikke vurdert: vises ikke i radaren.`,
    radarTooFew: (assessed: number) => `Radaren vises når minst 3 ferdigheter er vurdert. Du har vurdert ${assessed}.`,
  },
} as const;

export const SELF_ASSESSED_LEVEL_COPY: Readonly<Record<SelfAssessedLevel, { name: string; description: string }>> = {
  1: { name: "Grunnleggende kjennskap", description: "Jeg har begrenset eller tidlig kjennskap til området." },
  2: { name: "Kan med støtte", description: "Jeg løser relevante oppgaver, men med støtte eller veiledning." },
  3: { name: "Kan selvstendig", description: "Jeg løser oppgaver selvstendig i vanlige situasjoner." },
  4: {
    name: "Avansert",
    description:
      "Jeg har dyp kompetanse, håndterer krevende eller ukjente situasjoner og bidrar til god praksis – for eksempel ved å veilede andre.",
  },
};

import type { SelfAssessedLevel } from "./domain/self-assessed-level";

/**
 * Norwegian copy for the personal skills page (docs/features/individual-skill-
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
  tabs: [
    { view: "oversikt", label: "Oversikt" },
    { view: "rediger", label: "Kompetansekart" },
    { view: "rolle", label: "Min rolle og mine bidrag" },
    { view: "deling", label: "Deling med team" },
  ],
} as const;

export const skillProfileCopy = {
  /** Up to three links to existing pages (visual-redesign BR-18). */
  nextSteps: {
    heading: "Neste steg",
    items: [
      { title: "Se kompetansebehovet i teamet", description: "Vurder hvilke områder teamet bør styrke.", href: "/teams" },
      { title: "Planlegg neste utviklingssamtale", description: "Sett agenda og felles fokus i samtalene dine.", href: "/me/conversations" },
      { title: "Gå til profilen din", description: "Profilen din og kontoinnstillinger.", href: "/me/profile" },
    ],
  },
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
  skillsHeading: "Ferdigheter",
  unassessed: "Ikke vurdert",
  clearRating: "Fjern vurdering",
  levelSummary: (level: number, levelName: string) => `Nivå ${level} · ${levelName}`,
  sameNameHint: (index: number, total: number) => `Kompetanseområde ${index} av ${total} med dette navnet. Vurder hvert område for seg.`,
  saving: "Lagrer…",
  saveFailed: "Vurderingen ble ikke lagret. Prøv igjen.",
  skillUnavailable: "Denne ferdigheten er ikke lenger tilgjengelig.",
  filterLegend: "Vis",
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
    moreAreas: (count: number) => `${count} flere ferdigheter`,
    summaryAdvancedTitle: "Ferdigheter på nivå 3–4",
    summaryAdvancedDetail: "Ferdigheter du har vurdert til nivå 3 eller 4.",
    summaryAssessedTitle: "Vurderte ferdigheter",
    summaryAssessedValue: (assessed: number, total: number) => `${assessed} av ${total}`,
    summaryAssessedDetail: "Ferdigheter du har vurdert av de tilgjengelige.",
    summaryDevelopTitle: "Ferdigheter å utvikle",
    summaryDevelopDetail: "Ferdigheter vurdert til nivå 1 eller 2. Dette er en beskrivelse, ikke et krav.",
    nextStepsHeading: "Neste steg",
    unassessedHint: (count: number) => (count === 1 ? "1 ferdighet er ikke vurdert ennå." : `${count} ferdigheter er ikke vurdert ennå.`),
    assessAction: "Vurder i Kompetansekart",
    reviewAction: "Gjennomgå og endre ferdighetene dine",
    goalsAction: "Åpne mine utviklingsmål",
    roleWorkspaceAction: "Min rolle og mine bidrag",
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

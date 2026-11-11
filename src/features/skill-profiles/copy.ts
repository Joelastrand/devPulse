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
  /**
   * Approved 2026-10-28 (role-profiles TASK-022): the C1 notice amendment for the owner-only role comparison.
   * Rendered directly after `privacyNotice`, which is unchanged (C2 BR-29 pins it).
   */
  roleComparisonNotice:
    "Dine ferdighetsvurderinger er private. De kan brukes til en valgfri sammenligning med din egen valgte målrolle. Sammenligningen er bare synlig for deg.",
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
    radarHeading: "Kompetanseprofil",
    radarLabel: (count: number) => `Kompetanseprofil for ${count} vurderte ferdigheter`,
    radarLegendOwn: "Min vurdering",
    radarLegendTarget: (roleName: string) => `Rolleforventning (${roleName})`,
    radarTooFew: "Vurder minst tre ferdigheter for å se kompetanseprofilen. Listen under viser alle ferdighetene.",
    radarOmitted: (count: number) => `${count} vurderte ferdigheter vises bare i listen.`,
    radarTargetHidden: "Rolleforventningen vises når alle ferdighetene i diagrammet har en forventning i målrollen.",
    radarTableCaption: "Nivå per ferdighet i kompetanseprofilen",
    areasHeading: "Kompetanseområder",
    seeAll: "Se alle ferdigheter",
    moreAreas: (count: number) => `${count} flere ferdigheter`,
    statusMeets: "Oppfyller",
    statusDevelopment: "Utviklingsmulighet",
    statusNotAssessed: "Ikke vurdert",
    statusUnavailable: "Ikke tilgjengelig",
    roleHeading: "Rolleutvikling",
    roleNone: "Ingen målrolle valgt ennå.",
    roleSelected: (roleName: string) => `Målrolle: ${roleName}`,
    roleDetail: (meets: number, total: number) => `Oppfyller forventningen i ${meets} av ${total} områder.`,
    roleAction: "Velg eller endre målrolle",
    suggestionsHeading: "Forslag til utvikling",
    suggestionsTargetIntro: "Områder under forventningen i målrollen.",
    suggestionsNoTargetIntro: "Områder på nivå 1 eller 2. Velg en målrolle for å se gapet mot en rolle.",
    suggestionsNone: "Ingen utviklingsområder akkurat nå.",
    suggestionExpected: (levelName: string) => `Forventet nivå: ${levelName}`,
    bannerHeading: "Fortsett utviklingen din",
    bannerTarget: (count: number, roleName: string) =>
      `Du har ${count} utviklingsområder som kan løfte deg mot rollen ${roleName}.`,
    bannerTargetNone: (roleName: string) => `Ingen utviklingsområder mot rollen ${roleName} akkurat nå.`,
    bannerNoTarget: (count: number) => `Du har ${count} ferdigheter på nivå 1 eller 2 å jobbe videre med.`,
    bannerAction: "Åpne Min utvikling",
    comparisonError: "Målrollen kunne ikke lastes akkurat nå.",
    summaryTargetNone: "Velg en målrolle for å se forventninger.",
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

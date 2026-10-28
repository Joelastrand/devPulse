import type { SelfAssessedLevel } from "./domain/self-assessed-level";

/**
 * Norwegian copy for the personal skills page (docs/features/individual-skill-
 * self-assessment/SPEC.md — BR-4, BR-5, BR-25, BR-26, BR-30). Level names and
 * descriptions are wording only: the canonical meaning of each level lives in
 * `domain/self-assessed-level.ts` and may not change here. No numeric "x av 4"
 * display, no seniority wording, and no promise that the data is never used
 * elsewhere (BR-5). The privacy notice was amended by team-skill-needs-and-matrix BR-29 (TASK-011).
 */
export const skillProfileCopy = {
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
  overviewHeading: "Oversikt",
  assessedOfAll: (assessed: number, total: number) => `Du har vurdert ${assessed} av ${total} ferdigheter.`,
  assessedOfShown: (assessed: number) => `Du har vurdert ${assessed} av de viste ferdighetene.`,
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
  levelCount: (levelName: string, count: number) => `${levelName}: ${count}`,
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

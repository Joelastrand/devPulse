import { SELF_ASSESSED_LEVEL_COPY } from "../skill-profiles/copy";
import type { RequiredLevel } from "./domain/skill-need";

/**
 * Norwegian copy for the team skill needs section (docs/features/team-skill-needs-and-matrix/
 * SPEC.md — BR-26, BR-27). A need is a team-level plan, never a requirement on a person; there are
 * no counts, evaluative words or unqualified "anonym" here (BR-34 #8). Level names are the C1 labels.
 */
export const teamSkillsCopy = {
  needs: {
    heading: "Kompetansebehov og dekning",
    intro: "Kompetansebehov er teamets plan for hvilke kompetanseområder det trenger. Det er ikke en vurdering av enkeltpersoner.",
    loading: "Laster kompetansebehov…",
    error: "Kompetansebehovene kunne ikke lastes akkurat nå.",
    forbidden: "Du har ikke tilgang til kompetansebehovene for dette teamet.",
    retryButton: "Prøv igjen",
    empty: "Ingen kompetansebehov er registrert.",
    emptyHint: "Teamledere registrerer behov.",
    readOnly: "Teamledere endrer kompetansebehovene.",
    truncated: "Listen kan være ufullstendig.",
    tableCaption: "Kompetansebehov for teamet",
    columnArea: "Kompetanseområde",
    columnNeed: "Behov",
    columnCoverage: "Dekning",
    unavailableAreaName: "Kompetanseområde",
    areaUnavailable: "Kompetanseområdet er ikke lenger tilgjengelig",
    coverageNotAvailableYet: "Dekning er ikke tilgjengelig ennå",
  },
} as const;

/** «Minst {r} bidragsytere på nivå «{nivånavn}» eller høyere» (SPEC BR-26); levels 2–4 only. */
export function needDescription(requiredCoverage: number, requiredLevel: RequiredLevel): string {
  const contributors = requiredCoverage === 1 ? "bidragsyter" : "bidragsytere";
  return `Minst ${requiredCoverage} ${contributors} på nivå «${SELF_ASSESSED_LEVEL_COPY[requiredLevel].name}» eller høyere`;
}

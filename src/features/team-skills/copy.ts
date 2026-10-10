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
  manage: {
    actionsColumn: "Handlinger",
    addHeading: "Legg til kompetansebehov",
    editHeading: (area: string) => `Endre behov for «${area}»`,
    targetHint: "Dette er et mål teamet setter for planlegging, ikke et resultat.",
    areaLabel: "Kompetanseområde",
    areaPlaceholder: "Velg kompetanseområde",
    levelLabel: "Nivå",
    coverageLabel: "Antall bidragsytere",
    coverageHint: "Et helt tall fra 1 til 20.",
    coverageInvalid: "Antall må være et helt tall fra 1 til 20.",
    areaRequired: "Velg et kompetanseområde.",
    noAreasLeft: "Alle kompetanseområder har allerede et behov.",
    noAreasAtAll: "Det finnes ingen kompetanseområder å velge mellom.",
    catalogTruncated: "Listen over kompetanseområder kan være ufullstendig.",
    addButton: "Legg til behov",
    saveButton: "Lagre endring",
    saving: "Lagrer…",
    cancelEdit: "Avbryt endring",
    editButton: "Endre",
    editAria: (area: string) => `Endre behov for ${area}`,
    deleteButton: "Slett",
    deleting: "Sletter…",
    deleteConfirmPrompt:
      "Behovet fjernes permanent og kan ikke angres. Dette gjelder bare teamets behov, ikke noen enkeltpersoners vurderinger.",
    deleteConfirmLabel: "Ja, slett",
    deleteCancelLabel: "Avbryt",
    saved: "Behovet er lagret.",
    deleted: "Behovet er slettet.",
    refreshFailed: "Listen kunne ikke oppdateres akkurat nå.",
    errors: {
      invalid_input: "Verdiene er ikke gyldige. Kontroller nivå og antall.",
      skill_unavailable: "Kompetanseområdet er ikke lenger tilgjengelig.",
      forbidden: "Du kan ikke endre kompetansebehov for dette teamet.",
      team_disabled: "Teamet er deaktivert, så kompetansebehov kan ikke endres.",
      unauthenticated: "Du er logget ut. Logg inn på nytt for å fortsette.",
      persistence_failed: "Endringen ble ikke lagret. Prøv igjen.",
      unknown: "Endringen ble ikke lagret. Prøv igjen.",
    },
  },
} as const;

/** «Minst {r} bidragsytere på nivå «{nivånavn}» eller høyere» (SPEC BR-26); levels 2–4 only. */
export function needDescription(requiredCoverage: number, requiredLevel: RequiredLevel): string {
  const contributors = requiredCoverage === 1 ? "bidragsyter" : "bidragsytere";
  return `Minst ${requiredCoverage} ${contributors} på nivå «${SELF_ASSESSED_LEVEL_COPY[requiredLevel].name}» eller høyere`;
}

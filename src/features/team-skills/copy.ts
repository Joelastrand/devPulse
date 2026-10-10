import { SELF_ASSESSED_LEVEL_COPY } from "../skill-profiles/copy";
import type { RequiredLevel } from "./domain/skill-need";
import { SKILL_COVERAGE_MIN_CONTRIBUTORS } from "./domain/skill-coverage-policy";

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

/**
 * The participation notice (SPEC BR-25): the approved two-layer wording. The threshold comes from the
 * policy constant, never a typed literal. It states the residual-risk caveat and never claims absolute
 * anonymity (BR-21); editorial rewording does not bump the notice version, a change of meaning does (BR-8).
 */
export const participationCopy = {
  heading: (teamName: string) => `Din deltakelse i «${teamName}»`,
  fallbackTeamName: "dette teamet",
  loading: "Laster deltakelsen din…",
  readError: "Deltakelsen din kunne ikke lastes akkurat nå.",
  retryButton: "Prøv igjen",
  stateNotContributing: "Du bidrar ikke",
  stateContributing: "Du bidrar",
  optInButton: "Bidra til teamets kompetanseoversikt",
  withdrawButton: "Slutt å bidra",
  saving: "Lagrer…",
  optedIn: "Du bidrar nå.",
  withdrawn: "Du bidrar ikke lenger.",
  optInUnavailable: "Teamet er deaktivert, så du kan ikke begynne å bidra nå.",
  noticeHeading: "Bidra til teamets kompetanseoversikt?",
  noticePoints: (teamName: string) =>
    [
      "Valgfritt – du bestemmer selv, team for team.",
      `Hvis du bidrar, kan egenvurderingene dine telle med når DevPulse beregner om «${teamName}» dekker sine kompetansebehov. Teamet ser aldri nivåene du har satt.`,
      `Teamet får bare en grov status per behov (dekket / ikke dekket ennå), og først når minst ${SKILL_COVERAGE_MIN_CONTRIBUTORS} bidragsytere har vurdert området.`,
      "Dette er ikke full anonymitet. Når noen blir med, forlater teamet eller slutter å bidra, kan statusene i noen tilfeller gi grov informasjon om gruppen.",
      "Du kan slutte når som helst. Forlater du teamet, fjernes deltakelsen din; blir du med igjen, må du velge på nytt.",
    ] as const,
  disclosureSummary: "Slik fungerer personvernet",
  disclosurePoints: [
    "Bare nivåene du selv har satt, slik de er nå, brukes – og bare for kompetanseområder du har vurdert.",
    "Alle medlemmer i teamet, også teamledere, ser den samme grove statusen; administratorer som ikke er medlem ser den ikke.",
    "Ingen ser hvem som bidrar, hvor mange som bidrar, eller hvilke nivåer som er satt.",
    `Hvert område vises først når minst ${SKILL_COVERAGE_MIN_CONTRIBUTORS} bidragsytere har vurdert det; før det vises «Ikke nok data».`,
    "Teamledere kan endre kompetansebehovene. Ved å endre dem over tid og sammenligne statusene kan en teamleder i noen tilfeller utlede grov informasjon om gruppen. Det samme gjelder hvis alle bidragsytere ligger på samme side av et nivå, eller hvis kolleger som kjenner hverandres nivåer samarbeider.",
    "Hvis du slutter å bidra, telles du ikke med neste gang statusen vises; egenvurderingen din slettes ikke.",
    "Det lagres ingen historikk over statuser.",
    "Dette er ikke en vurdering av deg og brukes ikke til å sammenligne eller rangere personer.",
  ],
  errors: {
    unauthenticated: "Du er logget ut. Logg inn på nytt for å fortsette.",
    forbidden: "Du kan ikke endre deltakelsen for dette teamet.",
    team_disabled: "Teamet er deaktivert, så du kan ikke begynne å bidra.",
    notice_outdated: "Personvernteksten er oppdatert. Les den og velg på nytt.",
    persistence_failed: "Endringen ble ikke lagret. Prøv igjen.",
    unknown: "Endringen ble ikke lagret. Prøv igjen.",
  },
} as const;

/** «Minst {r} bidragsytere på nivå «{nivånavn}» eller høyere» (SPEC BR-26); levels 2–4 only. */
export function needDescription(requiredCoverage: number, requiredLevel: RequiredLevel): string {
  const contributors = requiredCoverage === 1 ? "bidragsyter" : "bidragsytere";
  return `Minst ${requiredCoverage} ${contributors} på nivå «${SELF_ASSESSED_LEVEL_COPY[requiredLevel].name}» eller høyere`;
}

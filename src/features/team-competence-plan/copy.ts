import type { MilestoneStatus } from "./domain/competence-plan";
import type { RoadmapPriority } from "../roadmap/domain/roadmap-item";

/**
 * Norwegian copy for the team Kompetanseplan (TASK-006, reference 20). Level names are NOT repeated here: the target
 * stage reuses `SELF_ASSESSED_LEVEL_COPY` from the skill-profiles copy, so there is one scale.
 */
export const competencePlanCopy = {
  heading: "Kompetanseplan",
  intro: "Plan for utvikling av kompetanser teamet trenger de neste månedene.",
  loading: "Laster kompetanseplanen…",
  loadError: "Kompetanseplanen kunne ikke lastes. Prøv igjen senere.",
  forbidden: "Du har ikke tilgang til kompetanseplanen for dette teamet.",
  retry: "Prøv igjen",
  emptyTitle: "Ingen kompetanseplaner ennå.",
  emptyHint: "Teamleder kan opprette en plan for et tildelt kompetanseområde.",
  truncated: "Viser de første planene. Ikke alle planer er lastet.",
  readOnlyNotice: "Bare teamleder kan endre kompetanseplanen. Planen er veiledende.",
  planCardLabel: (area: string) => `Kompetanseplan for ${area}`,
  areaUnavailable: "Kompetanseområdet er ikke tilgjengelig",
  archivedNotice: "Arkivert",
  priorityLabel: "Prioritet",
  targetStageLabel: "Målnivå",
  progress: (completed: number, total: number) => `${completed} av ${total} steg`,
  progressNone: "Ingen steg ennå",
  cardStatusHeading: "Status",
  progressBarLabel: "Fremdrift i planen (fullførte steg)",
  details: "Detaljer og tiltak",
  showDetails: "Vis steg",
  hideDetails: "Skjul steg",
  edit: "Rediger plan",
  newPlan: "Ny plan",
  newPlanHeading: "Legg til plan for et kompetanseområde",
  newPlanSelect: "Kompetanseområde",
  newPlanSelectHint: "Bare tildelte, aktive kompetanseområder uten plan vises.",
  legacyHeading: "Eksisterende kompetansesteg",
  legacyHint: "Fra roadmap. Vises uendret og endres i Roadmap.",
  legacyEmpty: "Ingen eksisterende kompetansesteg.",
  legacyFailed: "Eksisterende kompetansesteg kunne ikke lastes.",
  noAreasAvailable: "Alle tildelte kompetanseområder har allerede en plan, eller det finnes ingen tildelte områder.",
  milestonesHeading: "Steg",
  milestoneTitle: "Steg",
  milestoneTargetDate: "Måldato",
  milestoneStatus: "Status",
  milestoneRemove: "Fjern steg",
  milestoneAdd: "Legg til steg",
  milestonesEmpty: "Ingen steg ennå.",
  checklistHeading: "Målsjekkliste",
  priorityField: "Prioritet",
  targetStageField: "Målnivå",
  archiveField: "Arkiver plan",
  save: "Lagre plan",
  saving: "Lagrer…",
  cancel: "Avbryt",
  saved: "Kompetanseplanen er lagret.",
  saveFailed: "Kompetanseplanen kunne ikke lagres. Prøv igjen.",
  saveConflict: "Kompetanseområdet er arkivert og kan ikke få plan.",
  saveForbidden: "Bare teamleder kan endre kompetanseplanen.",
  invalidInput: "Kontroller feltene. Hver milepæl trenger en tittel.",
} as const;

export const planOverviewCopy = {
  goalsHeading: "Mål for kompetanseutvikling",
  goalsHint: "Stegene i planene. Avkrysset når steget er fullført.",
  goalsEmpty: "Ingen mål er lagt inn ennå.",
  goalDone: "Fullført",
  goalOpen: "Ikke fullført",
  timelineHeading: "Tidslinje for planene",
  timelineHint: "Dato for hvert steg i planene. Stolpen viser tidsrommet for planens steg.",
  spanGroup: "Tidsvindu",
  span: (months: 3 | 6) => (months === 3 ? "3 måneder" : "6 måneder"),
  areaColumn: "Kompetanseområde",
  mobileNotice: "Tidslinjen vises på større skjermer. Stegene med dato vises under.",
  noDatesInWindow: "Ingen datoer i dette tidsrommet",
  timelineEmpty: "Ingen steg med dato i de valgte månedene.",
  nextStepsHeading: "Neste steg",
  nextStepsEmpty: "Ingen åpne steg i planene.",
  needsHeading: "Teamets behov",
  needsHint: "Kompetanseområder prioritert av teamet.",
  needsEmpty: "Ingen planer å prioritere ennå.",
} as const;

export const MILESTONE_STATUS_LABEL: Readonly<Record<MilestoneStatus, string>> = {
  planned: "Planlagt",
  in_progress: "Pågår",
  completed: "Fullført",
};

export const PLAN_CARD_STATUS_LABEL: Readonly<Record<"not_started" | "in_progress" | "completed" | "no_steps", string>> = {
  not_started: "Ikke startet",
  in_progress: "Pågår",
  completed: "Fullført",
  no_steps: "Ingen steg ennå",
};

export const PRIORITY_LABEL: Readonly<Record<RoadmapPriority, string>> = {
  high: "Høy",
  medium: "Middels",
  low: "Lav",
};

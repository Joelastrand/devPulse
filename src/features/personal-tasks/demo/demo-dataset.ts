import type { PersonalTask, TaskPriority, TaskStatus } from "../domain/task";

/**
 * Fictional demonstration tasks for the presenter account in the existing `devpulse-nve` project (SEED TOOL DATA).
 *
 * All text is fictional and must stay non-sensitive: no real incidents, system names, URLs, credentials or colleague
 * details. The records are ordinary personal tasks written through the approved codec. Their ids use the reserved
 * prefix below, so the tool can tell its own records from the presenter's ordinary tasks without reading their content.
 *
 * Timestamps are fixed. "Recent" completions are within seven days of the reference date below; after that date they
 * move to history, which is expected. The reference date is documentation, not a runtime clock.
 */
export const DEMO_PROJECT_ID = "devpulse-nve";
export const DEMO_PRESENTER_UID = "koEwzQcj5Uc0hnjTgZBLithgkYB3";
export const DEMO_TASK_ID_PREFIX = "kanban-demo-";
export const DEMO_REFERENCE_DATE = "2026-11-18";

export interface DemoTaskSpec {
  /** Two-digit key, unique and stable. The task id is `DEMO_TASK_ID_PREFIX` + key. */
  key: string;
  status: TaskStatus;
  title: string;
  description: string | null;
  notes: string | null;
  priority: TaskPriority | null;
  dueDate: string | null;
  /** ISO timestamp for `completedAt`; required exactly when `status` is `done`. */
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Column position (ascending = top of the column). */
  position: number;
}

const COLUMN_STEP = 1024;

/** Column-relative positions, so every column has its own stable order. */
function positions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * COLUMN_STEP);
}

const BACKLOG_POSITIONS = positions(10);
const DOING_POSITIONS = positions(6);
const BLOCKED_POSITIONS = positions(3);
const DONE_POSITIONS = positions(5);

/** Lifecycle timestamps are spread over October and November 2026 so ordering and history are visible. */
function createdAtFor(index: number): string {
  return new Date(Date.UTC(2026, 9, 5, 8) + index * 3_600_000).toISOString();
}

export const DEMO_TASK_SPECS: readonly DemoTaskSpec[] = [
  // Backlog (10)
  {
    key: "01", status: "backlog", title: "Gjennomgå dokumentasjon for interne API-er",
    description: "Gå gjennom dokumentasjonen for de interne API-ene og merk det som mangler.",
    notes: null, priority: "normal", dueDate: null, completedAt: null,
    createdAt: createdAtFor(1), updatedAt: createdAtFor(1), position: BACKLOG_POSITIONS[0],
  },
  {
    key: "02", status: "backlog", title: "Oppdatere oversikt over systemavhengigheter",
    description: null,
    notes: "Eksempel: en fiktiv liste over avhengigheter mellom tre tenkte tjenester.",
    priority: "low", dueDate: "2026-12-04", completedAt: null,
    createdAt: createdAtFor(2), updatedAt: createdAtFor(2), position: BACKLOG_POSITIONS[1],
  },
  {
    key: "03", status: "backlog", title: "Forberede neste kompetansesamtale",
    description: null,
    notes: "Ta med eksempler fra fiktive prosjekter. Dette notatet er bare for meg.",
    priority: "high", dueDate: "2026-11-27", completedAt: null,
    createdAt: createdAtFor(3), updatedAt: createdAtFor(3), position: BACKLOG_POSITIONS[2],
  },
  {
    key: "04", status: "backlog", title: "Kartlegge behov for automatiserte tester",
    description: "Se på hvilke deler av en fiktiv tjeneste som bør testes automatisk først, og hvorfor.",
    notes: null, priority: "normal", dueDate: null, completedAt: null,
    createdAt: createdAtFor(4), updatedAt: createdAtFor(4), position: BACKLOG_POSITIONS[3],
  },
  {
    key: "05", status: "backlog", title: "Vurdere forbedringer i utviklingsmiljøet",
    description: null, notes: null, priority: null, dueDate: null, completedAt: null,
    createdAt: createdAtFor(5), updatedAt: createdAtFor(5), position: BACKLOG_POSITIONS[4],
  },
  {
    key: "06", status: "backlog", title: "Dokumentere rutiner for hendelseshåndtering",
    description: "Utkast til en enkel rutine for hendelseshåndtering i et fiktivt eksempel.",
    notes: "Trenger en mal først.", priority: "normal", dueDate: "2026-12-15", completedAt: null,
    createdAt: createdAtFor(6), updatedAt: createdAtFor(6), position: BACKLOG_POSITIONS[5],
  },
  {
    key: "07", status: "backlog", title: "Planlegge kompetanseheving innen sikkerhet",
    description: null, notes: null, priority: "low", dueDate: null, completedAt: null,
    createdAt: createdAtFor(7), updatedAt: createdAtFor(7), position: BACKLOG_POSITIONS[6],
  },
  {
    key: "08", status: "backlog", title: "Gjennomgå teknisk gjeld",
    description: "Liste over kjent teknisk gjeld i eksempelprosjektet, sortert etter hvor mye den koster å la stå.",
    notes: null, priority: null, dueDate: null, completedAt: null,
    createdAt: createdAtFor(8), updatedAt: createdAtFor(8), position: BACKLOG_POSITIONS[7],
  },
  {
    key: "09", status: "backlog", title: "Oppdatere systembeskrivelser",
    description: null, notes: null, priority: "normal", dueDate: "2026-12-01", completedAt: null,
    createdAt: createdAtFor(9), updatedAt: createdAtFor(9), position: BACKLOG_POSITIONS[8],
  },
  {
    key: "10", status: "backlog", title: "Forberede forslag til forbedret logging",
    description: "Kort forslag om strukturert logging i en fiktiv tjeneste. Ingen sensitive data i loggene.",
    notes: "Husk å sjekke at ingen personopplysninger havner i loggene.", priority: "high", dueDate: null, completedAt: null,
    createdAt: createdAtFor(10), updatedAt: createdAtFor(10), position: BACKLOG_POSITIONS[9],
  },

  // Pågår (6). Task 12 is overdue on purpose: the due date is before the reference date.
  {
    key: "11", status: "doing", title: "Forberede presentasjon av devPulse",
    description: "Lag en kort demo-gjennomgang av oversikten og tavlen.",
    notes: "Vis tavlen på mobil også.", priority: "high", dueDate: "2026-11-20", completedAt: null,
    createdAt: createdAtFor(11), updatedAt: createdAtFor(11), position: DOING_POSITIONS[0],
  },
  {
    key: "12", status: "doing", title: "Forbedre automatiserte tester",
    description: null, notes: "Fokus på ustabile tester i en fiktiv eksempelmodul.", priority: "normal", dueDate: "2026-11-10",
    completedAt: null, createdAt: createdAtFor(12), updatedAt: createdAtFor(12), position: DOING_POSITIONS[1],
  },
  {
    key: "13", status: "doing", title: "Gjennomgå tilgangsstyring i et eksempelprosjekt med mange roller og unntak som må dokumenteres",
    description: "Se hvem som har tilgang til hva i et fiktivt eksempelprosjekt, og om tilgangene fortsatt er nødvendige.",
    notes: null, priority: "normal", dueDate: null, completedAt: null,
    createdAt: createdAtFor(13), updatedAt: createdAtFor(13), position: DOING_POSITIONS[2],
  },
  {
    key: "14", status: "doing", title: "Oppdatere teknisk dokumentasjon",
    description: null, notes: null, priority: "low", dueDate: null, completedAt: null,
    createdAt: createdAtFor(14), updatedAt: createdAtFor(14), position: DOING_POSITIONS[3],
  },
  {
    key: "15", status: "doing", title: "Analysere kompetansebehov i teamet",
    description: "Basert på fiktive svar i en tenkt undersøkelse.",
    notes: null, priority: null, dueDate: "2026-12-02", completedAt: null,
    createdAt: createdAtFor(15), updatedAt: createdAtFor(15), position: DOING_POSITIONS[4],
  },
  {
    key: "16", status: "doing", title: "Forbedre overvåking av interne tjenester",
    description: null, notes: "Eksempel: varsel ved høy svartid i en fiktiv tjeneste.", priority: "high", dueDate: null, completedAt: null,
    createdAt: createdAtFor(16), updatedAt: createdAtFor(16), position: DOING_POSITIONS[5],
  },

  // Blokkert (3)
  {
    key: "17", status: "blocked", title: "Avklare tilgang til testmiljø",
    description: "Venter på godkjenning fra en fiktiv tilgangsansvarlig.",
    notes: null, priority: "high", dueDate: null, completedAt: null,
    createdAt: createdAtFor(17), updatedAt: createdAtFor(17), position: BLOCKED_POSITIONS[0],
  },
  {
    key: "18", status: "blocked", title: "Avvente tilbakemelding på API-endringer",
    description: null, notes: "Fiktiv avhengighet: svar forventes fra eksempelteamet.", priority: "normal", dueDate: "2026-11-25",
    completedAt: null, createdAt: createdAtFor(18), updatedAt: createdAtFor(18), position: BLOCKED_POSITIONS[1],
  },
  {
    key: "19", status: "blocked", title: "Avklare prioritering av systemoppgradering",
    description: null, notes: null, priority: null, dueDate: null, completedAt: null,
    createdAt: createdAtFor(19), updatedAt: createdAtFor(19), position: BLOCKED_POSITIONS[2],
  },

  // Fullført (5): three within seven days of the reference date, two older (history only once the window passes).
  {
    key: "20", status: "done", title: "Opprette demonstrasjonsdata",
    description: null, notes: null, priority: null, dueDate: null, completedAt: "2026-11-17T09:00:00.000Z",
    createdAt: createdAtFor(20), updatedAt: "2026-11-17T09:00:00.000Z", position: DONE_POSITIONS[0],
  },
  {
    key: "21", status: "done", title: "Gjennomgå eksisterende kompetanseoversikt",
    description: null, notes: "Fiktiv oversikt. Ingen reelle data.", priority: "low", dueDate: null,
    completedAt: "2026-11-16T14:00:00.000Z",
    createdAt: createdAtFor(21), updatedAt: "2026-11-16T14:00:00.000Z", position: DONE_POSITIONS[1],
  },
  {
    key: "22", status: "done", title: "Dokumentere eksempel på systemansvar",
    description: "Eksempel på hvordan systemansvar kan beskrives. Fiktivt.", notes: null, priority: null, dueDate: null,
    completedAt: "2026-11-14T10:00:00.000Z",
    createdAt: createdAtFor(22), updatedAt: "2026-11-14T10:00:00.000Z", position: DONE_POSITIONS[2],
  },
  {
    key: "23", status: "done", title: "Forberede første utkast til prosjektplan",
    description: null, notes: null, priority: "normal", dueDate: null,
    completedAt: "2026-10-22T10:00:00.000Z",
    createdAt: createdAtFor(23), updatedAt: "2026-10-22T10:00:00.000Z", position: DONE_POSITIONS[3],
  },
  {
    key: "24", status: "done", title: "Oppdatere personlig utviklingsmål",
    description: null, notes: "Fiktivt eksempel på et utviklingsmål.", priority: null, dueDate: null,
    completedAt: "2026-10-12T10:00:00.000Z",
    createdAt: createdAtFor(24), updatedAt: "2026-10-12T10:00:00.000Z", position: DONE_POSITIONS[4],
  },
];

export function demoTaskId(key: string): string {
  return `${DEMO_TASK_ID_PREFIX}${key}`;
}

/** True for an id in the demo namespace. Ordinary tasks use random ids and never match. */
export function isDemoTaskId(id: string): boolean {
  return id.startsWith(DEMO_TASK_ID_PREFIX);
}

/** The domain task a spec describes. The id is the demo id. */
export function toDemoPersonalTask(spec: DemoTaskSpec): PersonalTask {
  return {
    id: demoTaskId(spec.key),
    title: spec.title,
    description: spec.description,
    notes: spec.notes,
    status: spec.status,
    priority: spec.priority,
    dueDate: spec.dueDate,
    position: spec.position,
    createdAt: new Date(spec.createdAt),
    updatedAt: new Date(spec.updatedAt),
    completedAt: spec.completedAt === null ? null : new Date(spec.completedAt),
  };
}

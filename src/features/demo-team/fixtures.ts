import { ASSESSMENT_ATTRIBUTES } from "../team-systems/domain/team-system";
import type { RoadmapItemRecord } from "../roadmap/domain/roadmap-item";
import type { SkillProgressRecord } from "../skill-trees/domain/skill-progress";
import type { SkillTreeRecord } from "../skill-trees/domain/skill-tree";
import type { Survey } from "../surveys/domain/survey";
import type { TeamMembershipRecord } from "../teams/domain/team-membership";
import type { Team } from "../teams/domain/team";

/**
 * Pure, I/O-free logical fixtures for the Demo Team dataset
 * (docs/archive/features/demo-team/SPEC.md — "Demo dataset"). Everything here is
 * synthetic and fictional. Sensitive payloads (survey answers, challenge
 * text) exist only as in-memory plaintext *logical* values; nothing in this
 * module encrypts or persists them — `plan.ts` encrypts them through an
 * injected `encrypt` when it builds the write plan.
 */

export const DEMO_TEAM_ID = "demo-team";
export const DEMO_TEAM_NAME = "Demoteam";

/**
 * Accountability string written only into the creation-time/acting-admin
 * fields the SPEC's "Audit actor — field-by-field" table lists. Supporting
 * evidence only, never ownership (the manifest is the ownership mechanism).
 */
export const DEMO_AUDIT_ACTOR = "demo-seed";

export const DEMO_SURVEY_NEXT_ID = "demo-survey-next";
export const DEMO_MINIMUM_RESPONSES = 5;
export const CLOSED_PERIOD_COUNT = 8;
/** The one closed period that intentionally stays below `minimumResponses`. */
export const INSUFFICIENT_PERIOD = 3;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SURVEY_WINDOW_MS = 7 * DAY_MS;
const PERIOD_SPACING_MS = 14 * DAY_MS;

/** Two-digit, 1-based period/response number used inside deterministic ids. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function demoSurveyId(period: number): string {
  return `demo-survey-${pad2(period)}`;
}

export function demoResponseId(period: number, response: number): string {
  return `demo-response-s${pad2(period)}-r${pad2(response)}`;
}

export function demoChallengeId(n: number): string {
  return `demo-challenge-${pad2(n)}`;
}

export type AnswerTuple = [flow: number, stress: number, fun: number];

// ---------------------------------------------------------------------------
// Dates (SPEC — "Survey fixtures and timing", BR-19)
// ---------------------------------------------------------------------------

/**
 * `asOf` must be a valid Date at exactly 00:00:00.000 UTC (day-granular). The
 * pure layer never reads the wall clock; the future CLI supplies the default.
 */
export function assertValidAsOf(asOf: Date): void {
  if (
    !(asOf instanceof Date) ||
    Number.isNaN(asOf.getTime()) ||
    asOf.getTime() % DAY_MS !== 0
  ) {
    throw new Error("asOf must be a valid Date at midnight UTC.");
  }
}

export interface SurveyPeriodDates {
  createdAt: Date;
  openedAt: Date;
  closedAt: Date;
}

/** `closedAt_i = asOf + 12h − 2d − (8 − i) × 14d`; `openedAt = closedAt − 7d`; `createdAt = openedAt − 1d`. */
export function surveyPeriodDates(asOf: Date, period: number): SurveyPeriodDates {
  assertValidAsOf(asOf);
  const closedMs =
    asOf.getTime() + 12 * HOUR_MS - 2 * DAY_MS - (CLOSED_PERIOD_COUNT - period) * PERIOD_SPACING_MS;
  const openedMs = closedMs - SURVEY_WINDOW_MS;
  return {
    createdAt: new Date(openedMs - DAY_MS),
    openedAt: new Date(openedMs),
    closedAt: new Date(closedMs),
  };
}

/** `submittedAt = openedAt + floor(7d × r / (n + 1))` — strictly inside the open window. */
export function responseSubmittedAt(openedAt: Date, response: number, count: number): Date {
  return new Date(openedAt.getTime() + Math.floor((SURVEY_WINDOW_MS * response) / (count + 1)));
}

// ---------------------------------------------------------------------------
// Survey response values (RNG-free)
// ---------------------------------------------------------------------------

interface PeriodTarget {
  count: number;
  flow: number;
  stress: number;
  fun: number;
}

/**
 * Per-period `n` and target means (SPEC — "Historical response / trend
 * fixtures"). Period 3 is intentionally below `minimumResponses`; the SPEC
 * leaves its means open, so they interpolate between periods 2 and 4.
 */
const PERIOD_TARGETS: readonly PeriodTarget[] = [
  { count: 8, flow: 3.1, stress: 3.9, fun: 3.0 },
  { count: 8, flow: 3.2, stress: 3.8, fun: 3.2 },
  { count: 3, flow: 3.3, stress: 3.7, fun: 3.3 },
  { count: 8, flow: 3.4, stress: 3.5, fun: 3.3 },
  { count: 8, flow: 3.6, stress: 3.3, fun: 3.5 },
  { count: 8, flow: 3.5, stress: 3.2, fun: 3.6 },
  { count: 8, flow: 3.8, stress: 2.9, fun: 3.7 },
  { count: 8, flow: 3.9, stress: 2.7, fun: 3.9 },
];

export function periodResponseCount(period: number): number {
  return PERIOD_TARGETS[period - 1].count;
}

export function periodTargetMeans(period: number): { flow: number; stress: number; fun: number } {
  const { flow, stress, fun } = PERIOD_TARGETS[period - 1];
  return { flow, stress, fun };
}

/**
 * Integers summing to exactly `round(target × count)`, split as evenly as
 * possible; when that would give a single distinct value, one entry is
 * lowered and one raised by 1 (sum unchanged) so every dimension has spread.
 * `rotation` shifts which respondent gets which value, so the three
 * dimensions do not line up into identical tuples.
 */
function distribute(target: number, count: number, rotation: number): number[] {
  const sum = Math.round(Number((target * count).toFixed(6)));
  const base = Math.floor(sum / count);
  const extra = sum - base * count;
  const values = Array.from({ length: count }, (_, i) => (i < extra ? base + 1 : base));

  if (extra === 0) {
    values[0] -= 1;
    values[count - 1] += 1;
  }

  if (values.some((v) => v < 1 || v > 5)) {
    throw new Error("Demo fixture target produced an out-of-range answer.");
  }

  const shift = rotation % count;
  return [...values.slice(shift), ...values.slice(0, shift)];
}

/** The answer tuples for one closed period (1-based), in response order. */
export function periodAnswers(period: number): AnswerTuple[] {
  const { count, flow, stress, fun } = PERIOD_TARGETS[period - 1];
  const flows = distribute(flow, count, period);
  const stresses = distribute(stress, count, period + 3);
  const funs = distribute(fun, count, period + 5);
  return flows.map((f, i): AnswerTuple => [f, stresses[i], funs[i]]);
}

// ---------------------------------------------------------------------------
// Logical fixture types
// ---------------------------------------------------------------------------

export type SurveyFixture = Omit<Survey, "surveyId">;

export interface ResponseFixture {
  id: string;
  surveyId: string;
  period: number;
  answers: AnswerTuple;
  submittedAt: Date;
}

export interface ChallengeFixture {
  id: string;
  /** Plaintext logical value; only ever persisted encrypted. */
  text: string;
  submittedAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  archivedAt?: Date;
  archivedBy?: string;
}

export interface SkillTreeFixture {
  id: string;
  record: SkillTreeRecord;
}

export interface SkillProgressFixture {
  treeId: string;
  record: SkillProgressRecord;
}

export interface RoadmapItemFixture {
  treeId: string;
  record: RoadmapItemRecord;
}

export interface DemoLogicalFixtures {
  team: Omit<Team, "teamId">;
  membership: TeamMembershipRecord;
  closedSurveys: { id: string; period: number; record: SurveyFixture }[];
  scheduledSurvey: { id: string; record: SurveyFixture };
  responses: ResponseFixture[];
  challenges: ChallengeFixture[];
  skillTrees: SkillTreeFixture[];
  skillProgress: SkillProgressFixture[];
  roadmapItems: RoadmapItemFixture[];
}

// ---------------------------------------------------------------------------
// Synthetic Norwegian content
// ---------------------------------------------------------------------------

const CHALLENGE_TEXTS = [
  "Kodegranskninger blir liggende i flere dager før noen ser på dem. Kan vi bli enige om en felles forventning til svartid?",
  "Mange møter havner midt på dagen og bryter opp konsentrert arbeid. Kan vi samle dem på faste tidspunkter?",
  "Dokumentasjonen for utrullingsprosessen er utdatert, og nye på laget bruker lang tid på å finne riktig fremgangsmåte.",
  "Bakvaktordningen er uklar. Vi trenger en tydelig oversikt over hvem som har ansvar når varsler kommer utenfor arbeidstid.",
  "Noen teststeg i byggløypa feiler tilfeldig og skaper støy. Kan vi rydde i de ustabile testene?",
] as const;

export const DEMO_SKILL_TREES = [
  {
    id: "demo-skill-testing",
    name: "Demo – Testautomatisering",
    labels: [
      "Manuell testing",
      "Enhetstester",
      "Integrasjonstester",
      "Automatiserte ende-til-ende-tester",
      "Tester som kjører i byggløypa",
    ],
  },
  {
    id: "demo-skill-delivery",
    name: "Demo – Leveranse",
    labels: [
      "Manuell utrulling",
      "Versjonskontroll og grenstrategi",
      "Automatisert bygg",
      "Automatisert utrulling til test",
      "Kontinuerlig levering",
      "Automatisk utrulling til produksjon",
    ],
  },
  {
    id: "demo-skill-observability",
    name: "Demo – Observerbarhet",
    labels: ["Grunnleggende logging", "Strukturert logging", "Målinger og dashbord", "Varsling og sporing"],
  },
  {
    id: "demo-skill-secure-dev",
    name: "Demo – Sikker utvikling",
    labels: ["Sikkerhetsbevissthet", "Skanning av avhengigheter", "Trusselmodellering", "Sikkerhet i byggløypa"],
  },
  // Personal development catalog (Phase 1). Org-wide skill trees referenced by the presenter's goals and skill levels.
  {
    id: "demo-skill-typescript",
    name: "Demo – TypeScript og React",
    labels: ["Grunnleggende typer", "Komponentmønstre", "Validering av ytre data", "Testbar frontend-arkitektur"],
  },
  {
    id: "demo-skill-api",
    name: "Demo – API-design og integrasjon",
    labels: ["Ressursorientert design", "Versjonering og feilkoder", "Idempotens og kontrakter", "Sikre integrasjonsmønstre"],
  },
  {
    id: "demo-skill-cloud",
    name: "Demo – Skyarkitektur",
    labels: ["Isolasjon av tjenester", "Nettverk og tilgangsstyring", "Skalering og kostnad", "Hendelsesdrevne løsninger"],
  },
  {
    id: "demo-skill-accessibility",
    name: "Demo – Universell utforming",
    labels: ["Semantisk HTML", "Tastaturnavigasjon", "WCAG 2.2 AA-kontroll", "Test med hjelpemiddelbrukere"],
  },
  {
    id: "demo-skill-architecture",
    name: "Demo – Arkitekturbeslutninger",
    labels: ["Dokumenterte beslutninger", "Avveininger og alternativer", "Ansvar for helhetlig løsning"],
  },
  {
    id: "demo-skill-mentoring",
    name: "Demo – Mentorering og teknisk ledelse",
    labels: ["Veiledning i kodegjennomgang", "Strukturert opplæring", "Ansvar for teknisk retning"],
  },
  {
    id: "demo-skill-data",
    name: "Demo – Datamodellering og datakvalitet",
    labels: ["Grunnleggende modellering", "Valideringsregler", "Målbar datakvalitet", "Forvaltning av datamodeller"],
  },
  {
    id: "demo-skill-incident",
    name: "Demo – Hendelseshåndtering",
    labels: ["Varsling og bakvakt", "Triage og kommunikasjon", "Etterarbeid og læring"],
  },
] as const;

/**
 * Team-level progress (SPEC — "SkillTree / SkillProgress fixtures"). Trees
 * absent here (secure-dev) are intentionally untracked. `currentNodeId` is a
 * zero-based `node-<index>`: testing = middle of 5 (stage 3), delivery
 * `node-4` per the SPEC, observability not started (`null`).
 */
export const DEMO_TRACKED_SKILLS: readonly { treeId: string; currentNodeId: string | null }[] = [
  { treeId: "demo-skill-testing", currentNodeId: "node-2" },
  { treeId: "demo-skill-delivery", currentNodeId: "node-4" },
  { treeId: "demo-skill-observability", currentNodeId: null },
];

/**
 * Representative team plans (team-skill-planning TASK-011), one per tracked
 * area. Always unassigned: no `ownerRef`, so no member identity of any kind is
 * seeded. Delivery is already at its target (current `node-4`) and completed.
 */
export const DEMO_ROADMAP_PLANS: readonly {
  treeId: string;
  targetNodeId: string;
  status: RoadmapItemRecord["status"];
  priority: RoadmapItemRecord["priority"];
  /** Day offsets from `asOf`; absent = undated. */
  dates?: { startOffsetDays: number; targetOffsetDays: number };
}[] = [
  {
    treeId: "demo-skill-testing",
    targetNodeId: "node-4",
    status: "active",
    priority: "high",
    dates: { startOffsetDays: -14, targetOffsetDays: 60 },
  },
  { treeId: "demo-skill-observability", targetNodeId: "node-2", status: "planned", priority: "medium" },
  { treeId: "demo-skill-delivery", targetNodeId: "node-4", status: "completed", priority: "low" },
];

/**
 * Team delivery projects (Phase 1). The model stores a sealed title, plaintext dates, lifecycle, priority and `archived`.
 * There is no description or owner field in the model, so none is written. A project is effectively `active` when it is
 * planned and its start date has passed, `planned` before that, and `completed` when its lifecycle is `completed`.
 */
export const DEMO_TEAM_PROJECTS: readonly {
  projectId: string;
  title: string;
  startOffsetDays: number;
  endOffsetDays: number;
  lifecycleStatus: "planned" | "completed";
  priority: "high" | "medium" | "low";
}[] = [
  { projectId: "demo-project-api", title: "Modernisering av interne API-er", startOffsetDays: -120, endOffsetDays: 60, lifecycleStatus: "planned", priority: "high" },
  { projectId: "demo-project-devplatform", title: "Forbedret utviklerplattform", startOffsetDays: -40, endOffsetDays: 90, lifecycleStatus: "planned", priority: "high" },
  { projectId: "demo-project-access", title: "Universell utforming av digitale tjenester", startOffsetDays: -20, endOffsetDays: 45, lifecycleStatus: "planned", priority: "medium" },
  { projectId: "demo-project-observability", title: "Bedre overvåking og hendelseshåndtering", startOffsetDays: 14, endOffsetDays: 120, lifecycleStatus: "planned", priority: "medium" },
  { projectId: "demo-project-dataquality", title: "Datakvalitet og automatiserte kontroller", startOffsetDays: -150, endOffsetDays: -20, lifecycleStatus: "completed", priority: "medium" },
  { projectId: "demo-project-delivery", title: "Sikker og effektiv leveranseprosess", startOffsetDays: -200, endOffsetDays: -45, lifecycleStatus: "completed", priority: "low" },
];

/**
 * Team systems (Systemoversikt). Each attribute is an assessment: `{ value, note }`. An attribute not listed is `ikke_vurdert`.
 * Notes are sealed by the systems codec. Eight systems: three healthy, five needing follow-up (values trenger_oppfolging or kritisk).
 */
export const DEMO_TEAM_SYSTEMS: readonly {
  systemId: string;
  name: string;
  description: string;
  assessments: Partial<Record<"availability" | "deployability" | "maintainability" | "observability" | "reliability" | "security" | "testability", { value: "god" | "trenger_oppfolging" | "kritisk" | "ikke_vurdert"; note: string | null }>>;
}[] = [
  { systemId: "demo-system-portal", name: "Selvbetjeningsportalen", description: "Innbyggernes inngang til digitale tjenester.", assessments: { availability: { value: "god", note: null }, deployability: { value: "god", note: null }, maintainability: { value: "god", note: "Tydelig eierskap og oppdatert dokumentasjon." }, observability: { value: "god", note: null }, reliability: { value: "god", note: null }, security: { value: "god", note: null }, testability: { value: "god", note: null } } },
  { systemId: "demo-system-notify", name: "Varslingstjenesten", description: "Sender e-post og SMS-varsler til brukere av portalen.", assessments: { availability: { value: "god", note: null }, deployability: { value: "god", note: null }, maintainability: { value: "god", note: null }, observability: { value: "god", note: null }, reliability: { value: "god", note: null }, security: { value: "god", note: null }, testability: { value: "god", note: null } } },
  { systemId: "demo-system-integration", name: "Integrasjonsplattformen", description: "Samler meldingsutvekslingen mellom fagsystemene.", assessments: { reliability: { value: "trenger_oppfolging", note: "Meldingskøene har hatt flere ustabile perioder de siste månedene." }, maintainability: { value: "trenger_oppfolging", note: "Flere integrasjoner bruker ulike mønstre for feilhåndtering." }, availability: { value: "god", note: null }, deployability: { value: "god", note: null }, observability: { value: "god", note: null }, security: { value: "god", note: null } } },
  { systemId: "demo-system-reporting", name: "Rapporteringstjenesten", description: "Genererer periodiske rapporter til ledelsen.", assessments: { testability: { value: "kritisk", note: "Mange ustabile tester i byggløypa gjør det vanskelig å endre rapportlogikken trygt." }, maintainability: { value: "trenger_oppfolging", note: null }, availability: { value: "god", note: null }, reliability: { value: "god", note: null } } },
  { systemId: "demo-system-auth", name: "Innlogging og sesjoner", description: "Håndterer innlogging, sesjoner og fornyelse av tilgang.", assessments: { security: { value: "god", note: "Ny sesjonshåndtering har kjørt i produksjon uten kjente hendelser." }, reliability: { value: "god", note: null }, observability: { value: "trenger_oppfolging", note: "Mangler strukturert logging av innloggingsfeil." }, availability: { value: "god", note: null } } },
  { systemId: "demo-system-datahub", name: "Datakatalogen", description: "Oversikt over datasett, eiere og kvalitetskrav.", assessments: { maintainability: { value: "kritisk", note: "Eldre datamodell uten valideringsregler; krever opprydding før nye datasett kan legges til." }, security: { value: "god", note: null }, availability: { value: "god", note: null } } },
  { systemId: "demo-system-forms", name: "Skjemamotoren", description: "Felles bibliotek for dynamiske skjemaer i portalen.", assessments: { testability: { value: "trenger_oppfolging", note: "Mangler automatiserte tilgjengelighetstester for skjemaene." }, deployability: { value: "god", note: null }, maintainability: { value: "god", note: null } } },
  { systemId: "demo-system-archive", name: "Eksportjobb for arkiv", description: "Nattlig eksport av dokumenter til arkivsystemet.", assessments: { deployability: { value: "trenger_oppfolging", note: "Utrulling skjer fortsatt manuelt og krever en koordinert sjekkliste." }, maintainability: { value: "trenger_oppfolging", note: "Skrevet for ett arkivformat; flere formater er planlagt." } } },
];

/** The persisted fields of one team system (name and description are sealed by the codec). Assessed attributes carry the demo actor. */
export function teamSystemRecord(s: (typeof DEMO_TEAM_SYSTEMS)[number], teamId: string, asOf: Date): Record<string, unknown> {
  const attributes = Object.fromEntries(
    ASSESSMENT_ATTRIBUTES.map((attribute) => {
      const assessment = s.assessments[attribute];
      return [
        attribute,
        assessment === undefined
          ? { value: "ikke_vurdert", note: null, assessedAt: null, assessedBy: null }
          : { value: assessment.value, note: assessment.note, assessedAt: asOf, assessedBy: DEMO_AUDIT_ACTOR },
      ];
    }),
  );
  return {
    teamId,
    name: s.name,
    description: s.description,
    backstageUrl: null,
    knowledgeMemberRefs: [],
    createdAt: asOf,
    createdBy: DEMO_AUDIT_ACTOR,
    updatedAt: asOf,
    updatedBy: DEMO_AUDIT_ACTOR,
    ...attributes,
  };
}

/**
 * The persisted-shape fields of one team project (title is sealed by the codec). Dates are `YYYY-MM-DD` relative to `asOf`. */
export function teamProjectRecord(p: (typeof DEMO_TEAM_PROJECTS)[number], teamId: string, asOf: Date): Record<string, unknown> {
  return {
    teamId,
    title: p.title,
    startDate: planDate(asOf, p.startOffsetDays),
    endDate: planDate(asOf, p.endOffsetDays),
    lifecycleStatus: p.lifecycleStatus,
    priority: p.priority,
    archived: false,
  };
}

/** `YYYY-MM-DD` of `asOf` shifted by whole days (asOf is midnight UTC). */
function planDate(asOf: Date, offsetDays: number): string {
  return new Date(asOf.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function buildRoadmapItems(asOf: Date, teamId: string): RoadmapItemFixture[] {
  return DEMO_ROADMAP_PLANS.map(({ treeId, targetNodeId, status, priority, dates }) => ({
    treeId,
    record: {
      teamId: teamId,
      treeId,
      targetNodeId,
      priority,
      status,
      ...(dates && {
        startDate: planDate(asOf, dates.startOffsetDays),
        targetDate: planDate(asOf, dates.targetOffsetDays),
      }),
      ...(status === "completed" && { completedAt: asOf }),
      createdAt: asOf,
      createdBy: DEMO_AUDIT_ACTOR,
      updatedAt: asOf,
      updatedBy: DEMO_AUDIT_ACTOR,
    },
  }));
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function offsetFromAsOf(asOf: Date, days: number, hours: number): Date {
  return new Date(asOf.getTime() - days * DAY_MS + hours * HOUR_MS);
}

function buildSurveys(asOf: Date, teamId: string): Pick<DemoLogicalFixtures, "closedSurveys" | "scheduledSurvey"> {
  const closedSurveys = Array.from({ length: CLOSED_PERIOD_COUNT }, (_, i) => {
    const period = i + 1;
    const dates = surveyPeriodDates(asOf, period);
    return {
      id: demoSurveyId(period),
      period,
      record: {
        teamId: teamId,
        title: `Teampuls – sprint ${period}`,
        accessMode: "authenticated",
        minimumResponses: DEMO_MINIMUM_RESPONSES,
        openedAt: dates.openedAt,
        closedAt: dates.closedAt,
        createdAt: dates.createdAt,
        createdBy: DEMO_AUDIT_ACTOR,
      } satisfies SurveyFixture,
    };
  });

  const scheduledSurvey = {
    id: DEMO_SURVEY_NEXT_ID,
    record: {
      teamId: teamId,
      title: "Teampuls – neste sprint",
      accessMode: "authenticated",
      minimumResponses: DEMO_MINIMUM_RESPONSES,
      createdAt: offsetFromAsOf(asOf, 1, 0),
      createdBy: DEMO_AUDIT_ACTOR,
    } satisfies SurveyFixture,
  };

  return { closedSurveys, scheduledSurvey };
}

function buildResponses(asOf: Date): ResponseFixture[] {
  return Array.from({ length: CLOSED_PERIOD_COUNT }, (_, i) => i + 1).flatMap((period) => {
    const { openedAt } = surveyPeriodDates(asOf, period);
    const answers = periodAnswers(period);
    return answers.map(
      (tuple, i): ResponseFixture => ({
        id: demoResponseId(period, i + 1),
        surveyId: demoSurveyId(period),
        period,
        answers: tuple,
        submittedAt: responseSubmittedAt(openedAt, i + 1, answers.length),
      }),
    );
  });
}

function buildChallenges(asOf: Date): ChallengeFixture[] {
  const submitted = [
    offsetFromAsOf(asOf, 9, 10),
    offsetFromAsOf(asOf, 6, 14),
    offsetFromAsOf(asOf, 3, 9),
    offsetFromAsOf(asOf, 24, 11),
    offsetFromAsOf(asOf, 50, 13),
  ];

  return CHALLENGE_TEXTS.map((text, i): ChallengeFixture => {
    const base: ChallengeFixture = { id: demoChallengeId(i + 1), text, submittedAt: submitted[i] };

    if (i === 3) {
      return { ...base, resolvedAt: offsetFromAsOf(asOf, 18, 11), resolvedBy: DEMO_AUDIT_ACTOR };
    }
    if (i === 4) {
      return { ...base, archivedAt: offsetFromAsOf(asOf, 30, 13), archivedBy: DEMO_AUDIT_ACTOR };
    }
    return base;
  });
}

function buildSkillTrees(asOf: Date): SkillTreeFixture[] {
  return DEMO_SKILL_TREES.map(({ id, name, labels }) => ({
    id,
    record: {
      name,
      nodes: labels.map((label, index) => ({ nodeId: `node-${index}`, label, order: index })),
      createdAt: asOf,
      createdBy: DEMO_AUDIT_ACTOR,
    },
  }));
}

/**
 * Builds the complete logical (pre-encryption) dataset. Pure: the same
 * `(presenterUid, asOf)` always yields equal values; no clock, no RNG, no I/O.
 * The presenter uid is used only as the membership `uid`.
 */
export function buildDemoLogicalFixtures(input: {
  teamId?: string;
  presenterUid: string;
  asOf: Date;
}): DemoLogicalFixtures {
  const { presenterUid, asOf } = input;
  const teamId = input.teamId ?? DEMO_TEAM_ID;
  assertValidAsOf(asOf);
  assertValidPresenterUid(presenterUid);

  const surveys = buildSurveys(asOf, teamId);

  return {
    team: {
      name: DEMO_TEAM_NAME,
      status: "active",
      createdAt: asOf,
      createdBy: DEMO_AUDIT_ACTOR,
    },
    membership: {
      uid: presenterUid,
      teamId: teamId,
      createdAt: asOf,
      createdVia: "admin_direct",
      grantedBy: DEMO_AUDIT_ACTOR,
    },
    ...surveys,
    responses: buildResponses(asOf),
    challenges: buildChallenges(asOf),
    skillTrees: buildSkillTrees(asOf),
    skillProgress: DEMO_TRACKED_SKILLS.map(({ treeId, currentNodeId }) => ({
      treeId,
      record: {
        teamId: teamId,
        treeId,
        currentNodeId,
        updatedAt: asOf,
        updatedBy: DEMO_AUDIT_ACTOR,
      },
    })),
    roadmapItems: buildRoadmapItems(asOf, teamId),
  };
}

/**
 * Structural check only (document-id safety); existence in Firebase Auth is
 * a later task's runtime concern. Rejects blank, over-long, whitespace- or
 * slash-containing values and the reserved `.`/`..` ids.
 */
export function assertValidPresenterUid(uid: string): void {
  if (typeof uid !== "string" || !/^[^/\s]{1,128}$/.test(uid) || uid === "." || uid === "..") {
    throw new Error("presenterUid is not a valid document-id segment.");
  }
}

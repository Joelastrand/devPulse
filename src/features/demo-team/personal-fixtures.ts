import type { SelfAssessedLevel } from "../skill-profiles/domain/self-assessed-level";
import type { ConversationContent } from "../development-conversations/domain/content-payload";
import { assertValidAsOf, assertValidPresenterUid } from "./fixtures";

/**
 * Pure, I/O-free logical fixtures for the presenter's "Min utvikling" demo profile (Phase 1). Everything here is
 * fictional demonstration data, written in Norwegian Bokmål. The persona is a senior full-stack developer: strong in
 * TypeScript, React, API design and architecture; developing in cloud architecture, accessibility, observability and
 * technical leadership.
 *
 * Nothing here encrypts or persists. `personal-plan.ts` seals each value with the existing codec for its record type.
 * Every date is derived from `asOf`, so the same `asOf` always yields the same dataset.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight-UTC `asOf` shifted by whole days (negative = past). */
function dayOffset(asOf: Date, days: number): Date {
  return new Date(asOf.getTime() + days * DAY_MS);
}

/** `YYYY-MM-DD` of `asOf` shifted by whole days. */
function isoDay(asOf: Date, days: number): string {
  return dayOffset(asOf, days).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Skill trees and skill levels
// ---------------------------------------------------------------------------

/**
 * Personal skill trees that are not part of the team demo. The four existing demo trees (testing, delivery,
 * observability, secure development) are reused for personal levels. Node labels are sealed by the skill-tree codec.
 */
/**
 * The personal skill trees are org-wide catalog entries defined once in `fixtures.ts` (`DEMO_SKILL_TREES`) and written by the
 * team catalog step. This module only references their ids; `personal-fixtures.test.ts` checks that every reference resolves.
 */
export const DEMO_PERSONAL_SKILL_TREE_IDS = [
  "demo-skill-typescript",
  "demo-skill-api",
  "demo-skill-cloud",
  "demo-skill-accessibility",
  "demo-skill-architecture",
  "demo-skill-mentoring",
  "demo-skill-data",
  "demo-skill-incident",
] as const;

/** Self-assessed levels (1–4) for the twelve skills of the persona. Strengths at 4, developing skills at 2. */
export const DEMO_PERSONAL_SKILL_LEVELS: readonly { treeId: string; level: SelfAssessedLevel }[] = [
  { treeId: "demo-skill-typescript", level: 4 },
  { treeId: "demo-skill-api", level: 4 },
  { treeId: "demo-skill-architecture", level: 3 },
  { treeId: "demo-skill-testing", level: 3 },
  { treeId: "demo-skill-delivery", level: 3 },
  { treeId: "demo-skill-secure-dev", level: 3 },
  { treeId: "demo-skill-mentoring", level: 2 },
  { treeId: "demo-skill-cloud", level: 2 },
  { treeId: "demo-skill-accessibility", level: 2 },
  { treeId: "demo-skill-observability", level: 2 },
  { treeId: "demo-skill-data", level: 2 },
  { treeId: "demo-skill-incident", level: 1 },
];

// ---------------------------------------------------------------------------
// Goals (owner-only; status, timestamps and content)
// ---------------------------------------------------------------------------

export interface PersonalGoalFixture {
  id: string;
  title: string;
  treeId: string;
  createdDaysAgo: number;
  /** Target date as days from `asOf` (negative = past). */
  targetInDays: number;
  /** Present only for completed goals: days before `asOf` when completed. */
  completedDaysAgo?: number;
}

export const DEMO_PERSONAL_GOALS: readonly PersonalGoalFixture[] = [
  {
    id: "demo-goal-01",
    title: "Fullføre skyarkitekturkurs og sertifisering",
    treeId: "demo-skill-cloud",
    createdDaysAgo: 150,
    targetInDays: 120,
  },
  {
    id: "demo-goal-02",
    title: "Lede arkitekturgjennomgang av integrasjonsplattformen",
    treeId: "demo-skill-architecture",
    createdDaysAgo: 110,
    targetInDays: 45,
  },
  {
    id: "demo-goal-03",
    title: "WCAG 2.2 AA på alle nye skjermer i portalen",
    treeId: "demo-skill-accessibility",
    createdDaysAgo: 95,
    // Overdue on purpose: still active after its target date.
    targetInDays: -10,
  },
  {
    id: "demo-goal-04",
    title: "Mentorere to utviklere til selvstendig levering",
    treeId: "demo-skill-mentoring",
    createdDaysAgo: 200,
    targetInDays: -30,
    // Completed two days after the target date.
    completedDaysAgo: 28,
  },
  {
    id: "demo-goal-05",
    title: "Strukturert logging med korrelasjons-ID i API-tjenestene",
    treeId: "demo-skill-observability",
    createdDaysAgo: 170,
    targetInDays: -60,
    completedDaysAgo: 52,
  },
  {
    id: "demo-goal-06",
    title: "Trusselmodell for ny meldingsutveksling med eksterne aktører",
    treeId: "demo-skill-secure-dev",
    createdDaysAgo: 40,
    targetInDays: 30,
  },
];

// ---------------------------------------------------------------------------
// Responsibilities and achievements (source-record codec)
// ---------------------------------------------------------------------------

export interface PersonalResponsibilityFixture {
  id: string;
  title: string;
  description: string;
  status: "active" | "completed";
  relationToRole: "within" | "beyond" | "unspecified";
  startDaysAgo: number | null;
  endDaysAgo: number | null;
  goalIds: string[];
  createdDaysAgo: number;
  updatedDaysAgo: number;
}

export const DEMO_PERSONAL_RESPONSIBILITIES: readonly PersonalResponsibilityFixture[] = [
  {
    id: "demo-resp-01",
    title: "Teknisk ansvarlig for selvbetjeningsportalen",
    description:
      "Har det tekniske ansvaret for portalens API og frontend. Prioriterer teknisk gjeld sammen med produkteier og sørger for at endringer kan rulles ut trygt uten å stoppe innbyggertjenester.",
    status: "active",
    relationToRole: "within",
    startDaysAgo: 365,
    endDaysAgo: null,
    goalIds: ["demo-goal-02", "demo-goal-03"],
    createdDaysAgo: 360,
    updatedDaysAgo: 6,
  },
  {
    id: "demo-resp-02",
    title: "Fagfellevurdering av kode i teamet",
    description:
      "Gjennomgår pull requests fra hele teamet, med særlig vekt på API-kontrakter, feilhåndtering og tilgangsstyring. Målet er at kodegjennomgang ikke skal ligge i kø lenger enn én arbeidsdag.",
    status: "active",
    relationToRole: "within",
    startDaysAgo: 300,
    endDaysAgo: null,
    goalIds: ["demo-goal-04"],
    createdDaysAgo: 300,
    updatedDaysAgo: 2,
  },
  {
    id: "demo-resp-03",
    title: "Bakvakt for integrasjonsplattformen",
    description:
      "Deltar i bakvaktordningen annenhver uke. Ansvarlig for førstelinjetriage av varsler fra meldingskøene og for å eskalere til plattformteamet når det trengs.",
    status: "active",
    relationToRole: "beyond",
    startDaysAgo: 120,
    endDaysAgo: null,
    goalIds: ["demo-goal-05"],
    createdDaysAgo: 120,
    updatedDaysAgo: 14,
  },
  {
    id: "demo-resp-04",
    title: "Felles mal for API-dokumentasjon",
    description:
      "Innførte en felles mal for dokumentasjon av åpne API-er, med eksempler på feilsvar og versjonering. Malen er tatt i bruk av to andre team.",
    status: "completed",
    relationToRole: "beyond",
    startDaysAgo: 240,
    endDaysAgo: 75,
    goalIds: [],
    createdDaysAgo: 240,
    updatedDaysAgo: 75,
  },
];

export interface PersonalAchievementFixture {
  id: string;
  title: string;
  description: string;
  outcome: string | null;
  relationToRole: "within" | "beyond" | "unspecified";
  periodStartDaysAgo: number | null;
  periodEndDaysAgo: number | null;
  goalIds: string[];
  responsibilityIds: string[];
  createdDaysAgo: number;
  updatedDaysAgo: number;
}

export const DEMO_PERSONAL_ACHIEVEMENTS: readonly PersonalAchievementFixture[] = [
  {
    id: "demo-ach-01",
    title: "Ny sesjonshåndtering i innloggingsflyten",
    description:
      "Erstattet den gamle sesjonsløsningen med kortlevde tokens og fornyelse på serversiden. Migreringen ble gjort uten nedetid, med trinnvis utrulling for en del av brukerne først.",
    outcome: "Ingen kjente sikkerhetshendelser etter utrulling. Innloggingen gikk fra om lag fire sekunder til under to.",
    relationToRole: "within",
    periodStartDaysAgo: 210,
    periodEndDaysAgo: 160,
    goalIds: [],
    responsibilityIds: ["demo-resp-01"],
    createdDaysAgo: 150,
    updatedDaysAgo: 150,
  },
  {
    id: "demo-ach-02",
    title: "Felles mønster for feilhåndtering i API-et",
    description:
      "Lagde en felles feilmodell med stabile feilkoder og tydelige meldinger på norsk. Modellen er dokumentert og brukes nå av alle tjenester i portalen.",
    outcome: "Færre supporthenvendelser om uforståelige feilmeldinger. Feilkodene er med i API-dokumentasjonen.",
    relationToRole: "within",
    periodStartDaysAgo: 260,
    periodEndDaysAgo: 220,
    goalIds: [],
    responsibilityIds: ["demo-resp-04"],
    createdDaysAgo: 215,
    updatedDaysAgo: 215,
  },
  {
    id: "demo-ach-03",
    title: "Workshop om tilgjengelige skjemaer",
    description:
      "Holdt en to timers workshop for teamet om semantiske skjemaer, feilmeldinger som kan leses av skjermlesere og tastaturnavigasjon. Gjennomgikk tre eksisterende skjemaer sammen med teamet.",
    outcome: null,
    relationToRole: "beyond",
    periodStartDaysAgo: 90,
    periodEndDaysAgo: 90,
    goalIds: ["demo-goal-03"],
    responsibilityIds: [],
    createdDaysAgo: 88,
    updatedDaysAgo: 88,
  },
  {
    id: "demo-ach-04",
    title: "Første mentee leverte selvstendig",
    description:
      "En av utviklerne jeg veileder tok over ansvaret for en avgrenset funksjon fra start til slutt, inkludert tester og utrulling, uten at jeg måtte gå inn i koden.",
    outcome: "Funksjonen gikk i produksjon uten tilbakerulling. Utvikleren presenterte leveransen på teamets demo.",
    relationToRole: "beyond",
    periodStartDaysAgo: 60,
    periodEndDaysAgo: 30,
    goalIds: ["demo-goal-04"],
    responsibilityIds: ["demo-resp-02"],
    createdDaysAgo: 28,
    updatedDaysAgo: 28,
  },
  {
    id: "demo-ach-05",
    title: "Kortere kø for kodegjennomgang",
    description:
      "Innførte fast tidspunkt for kodegjennomgang to ganger om dagen og en enkel regel for hva som kan vente. Målte ventetiden i to måneder før og etter.",
    outcome: "Gjennomsnittlig tid fra pull request til første gjennomgang gikk fra tre dager til én dag.",
    relationToRole: "within",
    periodStartDaysAgo: 75,
    periodEndDaysAgo: 40,
    goalIds: [],
    responsibilityIds: ["demo-resp-02"],
    createdDaysAgo: 40,
    updatedDaysAgo: 40,
  },
];

// ---------------------------------------------------------------------------
// Development conversation (owner-only, open)
// ---------------------------------------------------------------------------

export interface PersonalConversationFixture {
  id: string;
  /** Days from `asOf` for the planned conversation date. */
  plannedInDays: number;
  createdDaysAgo: number;
  updatedDaysAgo: number;
  content: ConversationContent;
}

export const DEMO_PERSONAL_CONVERSATION: PersonalConversationFixture = {
  id: "demo-conversation-01",
  plannedInDays: 14,
  createdDaysAgo: 9,
  updatedDaysAgo: 2,
  content: {
    title: "Utviklingssamtale med leder – høst",
    ownerNotes:
      "Vi snakket om at jeg har fått mer ansvar for arkitekturen, men at jeg fortsatt bruker mye tid i detaljer. Jeg vil bli bedre på å delegere implementasjonen og være tydeligere på hva jeg forventer av beslutningene mine.\n\nSkyarkitektur er fortsatt det området jeg vil styrke mest. Sertifiseringskurset er planlagt, men jeg har for lite praktisk erfaring med nettverk og tilgangsstyring i produksjon.\n\nTilgjengelighet: de siste skjermene har fortsatt mangler med tastaturnavigasjon. Jeg vil be om at dette får plass i sprintplanen.",
    nextSteps: [
      "Velge én arkitekturbeslutning per måned som jeg dokumenterer og lar andre eie.",
      "Starte kurset i skyarkitektur og avtale to timer per uke til øvelse i sandkassemiljøet.",
      "Legge tilgjengelighetssjekk inn i definisjonen av ferdig for nye skjermer.",
    ],
    participantNotes: "",
    sharedGoals: [],
    sharedEvidence: [],
  },
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface PersonalLogicalFixtures {
  presenterUid: string;
  asOf: Date;
  skillLevels: readonly { treeId: string; level: SelfAssessedLevel }[];
  goals: readonly {
    id: string;
    status: "active" | "completed";
    title: string;
    treeId: string;
    targetDate: string;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }[];
  responsibilities: readonly {
    id: string;
    payload: { title: string; description: string };
    plain: {
      status: "active" | "completed";
      relationToRole: "within" | "beyond" | "unspecified";
      startDate: string | null;
      endDate: string | null;
      goalIds: string[];
    };
    createdAt: Date;
    updatedAt: Date;
  }[];
  achievements: readonly {
    id: string;
    payload: { title: string; description: string; outcome: string | null };
    plain: {
      relationToRole: "within" | "beyond" | "unspecified";
      periodStart: string | null;
      periodEnd: string | null;
      goalIds: string[];
      responsibilityIds: string[];
    };
    createdAt: Date;
    updatedAt: Date;
  }[];
  conversation: {
    id: string;
    plannedFor: string;
    createdAt: Date;
    updatedAt: Date;
    content: ConversationContent;
  };
}

/**
 * Builds the complete logical personal dataset. Pure: same `(presenterUid, asOf)` yields equal values. Only the
 * presenter's own uid is used, as the ownership path segment; no other identity is ever referenced.
 */
export function buildPersonalLogicalFixtures(input: { presenterUid: string; asOf: Date }): PersonalLogicalFixtures {
  const { presenterUid, asOf } = input;
  assertValidAsOf(asOf);
  assertValidPresenterUid(presenterUid);

  return {
    presenterUid,
    asOf,
    skillLevels: DEMO_PERSONAL_SKILL_LEVELS,
    goals: DEMO_PERSONAL_GOALS.map((g) => ({
      id: g.id,
      status: g.completedDaysAgo === undefined ? "active" : "completed",
      title: g.title,
      treeId: g.treeId,
      targetDate: isoDay(asOf, g.targetInDays),
      createdAt: dayOffset(asOf, -g.createdDaysAgo),
      updatedAt:
        g.completedDaysAgo === undefined ? dayOffset(asOf, -Math.min(g.createdDaysAgo, 5)) : dayOffset(asOf, -g.completedDaysAgo),
      completedAt: g.completedDaysAgo === undefined ? null : dayOffset(asOf, -g.completedDaysAgo),
    })),
    responsibilities: DEMO_PERSONAL_RESPONSIBILITIES.map((r) => ({
      id: r.id,
      payload: { title: r.title, description: r.description },
      plain: {
        status: r.status,
        relationToRole: r.relationToRole,
        startDate: r.startDaysAgo === null ? null : isoDay(asOf, -r.startDaysAgo),
        endDate: r.endDaysAgo === null ? null : isoDay(asOf, -r.endDaysAgo),
        goalIds: [...r.goalIds],
      },
      createdAt: dayOffset(asOf, -r.createdDaysAgo),
      updatedAt: dayOffset(asOf, -r.updatedDaysAgo),
    })),
    achievements: DEMO_PERSONAL_ACHIEVEMENTS.map((a) => ({
      id: a.id,
      payload: { title: a.title, description: a.description, outcome: a.outcome },
      plain: {
        relationToRole: a.relationToRole,
        periodStart: a.periodStartDaysAgo === null ? null : isoDay(asOf, -a.periodStartDaysAgo),
        periodEnd: a.periodEndDaysAgo === null ? null : isoDay(asOf, -a.periodEndDaysAgo),
        goalIds: [...a.goalIds],
        responsibilityIds: [...a.responsibilityIds],
      },
      createdAt: dayOffset(asOf, -a.createdDaysAgo),
      updatedAt: dayOffset(asOf, -a.updatedDaysAgo),
    })),
    conversation: {
      id: DEMO_PERSONAL_CONVERSATION.id,
      plannedFor: isoDay(asOf, DEMO_PERSONAL_CONVERSATION.plannedInDays),
      createdAt: dayOffset(asOf, -DEMO_PERSONAL_CONVERSATION.createdDaysAgo),
      updatedAt: dayOffset(asOf, -DEMO_PERSONAL_CONVERSATION.updatedDaysAgo),
      content: DEMO_PERSONAL_CONVERSATION.content,
    },
  };
}

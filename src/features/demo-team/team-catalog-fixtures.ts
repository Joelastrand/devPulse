import { DEMO_AUDIT_ACTOR, assertValidAsOf } from "./fixtures";

/**
 * Team competence plans (Kompetanseplan) and the team skill catalog (Teamkompetanse). Fictional Norwegian demo data. Plans
 * are independent of team skill needs and of any individual rating. Plan ids are UUID-shaped and stable, as the plan model
 * requires. Progress is derived from milestone statuses, and deadlines are milestone target dates.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(asOf: Date, days: number): string {
  return new Date(asOf.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

type MilestoneStatus = "planned" | "in_progress" | "completed";
type Priority = "high" | "medium" | "low";

export interface CompetencePlanFixture {
  planId: string;
  title: string;
  /** The four self-assessment levels (1–4), as defined by the domain. */
  targetStage: 1 | 2 | 3 | 4;
  priority: Priority;
  archived: boolean;
  milestones: readonly { id: string; title: string; targetOffsetDays: number | null; status: MilestoneStatus }[];
}

const planUuid = (n: number) => `5f1d0c00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const milestoneId = (plan: number, n: number) => `6a2e1d00-0000-4000-8000-${String(plan * 100 + n).padStart(12, "0")}`;

/** Six plans: three high priority (the overview's prioritized count), two medium, one low and archived. */
export const DEMO_COMPETENCE_PLANS: readonly CompetencePlanFixture[] = [
  {
    planId: planUuid(1),
    title: "Skyplattform og sikker drift",
    targetStage: 3,
    priority: "high",
    archived: false,
    milestones: [
      { id: milestoneId(1, 1), title: "Fullføre skyarkitekturkurs", targetOffsetDays: -20, status: "completed" },
      { id: milestoneId(1, 2), title: "Sette opp nettverkssegmentering i testmiljø", targetOffsetDays: 30, status: "in_progress" },
      { id: milestoneId(1, 3), title: "Gjennomgå tilgangsstyring for produksjon", targetOffsetDays: 75, status: "planned" },
    ],
  },
  {
    planId: planUuid(2),
    title: "Universell utforming",
    targetStage: 3,
    priority: "high",
    archived: false,
    milestones: [
      { id: milestoneId(2, 1), title: "WCAG 2.2 AA-kontroll i designsystemet", targetOffsetDays: 21, status: "in_progress" },
      { id: milestoneId(2, 2), title: "Tastaturtest for alle skjemaer", targetOffsetDays: 60, status: "planned" },
      { id: milestoneId(2, 3), title: "Brukertest med hjelpemiddelbrukere", targetOffsetDays: 120, status: "planned" },
    ],
  },
  {
    planId: planUuid(3),
    title: "Observability og hendelseshåndtering",
    targetStage: 2,
    priority: "high",
    archived: false,
    milestones: [
      { id: milestoneId(3, 1), title: "Strukturert logging i API-tjenestene", targetOffsetDays: -45, status: "completed" },
      { id: milestoneId(3, 2), title: "Varsling med tydelige eierskap", targetOffsetDays: -5, status: "in_progress" },
      { id: milestoneId(3, 3), title: "Øvelse for hendelseshåndtering", targetOffsetDays: 45, status: "planned" },
    ],
  },
  {
    planId: planUuid(4),
    title: "API-design og integrasjoner",
    targetStage: 3,
    priority: "medium",
    archived: false,
    milestones: [
      { id: milestoneId(4, 1), title: "Felles feilmodell dokumentert", targetOffsetDays: -60, status: "completed" },
      { id: milestoneId(4, 2), title: "Versjonsstrategi for offentlige API-er", targetOffsetDays: 40, status: "in_progress" },
      { id: milestoneId(4, 3), title: "Kontraktstester for integrasjonene", targetOffsetDays: 90, status: "planned" },
    ],
  },
  {
    planId: planUuid(5),
    title: "Automatisert testing",
    targetStage: 2,
    priority: "medium",
    archived: false,
    milestones: [
      { id: milestoneId(5, 1), title: "Stabilisere ustabile tester i byggløypa", targetOffsetDays: 14, status: "planned" },
      { id: milestoneId(5, 2), title: "Ende-til-ende-tester for innlogging", targetOffsetDays: 60, status: "planned" },
    ],
  },
  {
    planId: planUuid(6),
    title: "Teknisk veiledning og kunnskapsdeling",
    targetStage: 2,
    priority: "low",
    archived: true,
    milestones: [{ id: milestoneId(6, 1), title: "Mentoringprogram for nye utviklere", targetOffsetDays: -90, status: "completed" }],
  },
];

/** The persisted-shape fields of one plan. Title and milestones are sealed by the codec. Timestamps are the as-of instant. */
export function competencePlanRecord(p: CompetencePlanFixture, teamId: string, asOf: Date) {
  assertValidAsOf(asOf);
  return {
    teamId,
    title: p.title,
    treeId: null,
    targetStage: p.targetStage,
    priority: p.priority,
    archived: p.archived,
    milestones: p.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      targetDate: m.targetOffsetDays === null ? null : isoDay(asOf, m.targetOffsetDays),
      status: m.status,
    })),
    createdAt: asOf,
    updatedAt: asOf,
  };
}

/** Team skill catalog (Teamkompetanse): 25 skills across seven categories. Stable alphanumeric ids. */
export const DEMO_TEAM_SKILLS: readonly {
  skillId: string;
  name: string;
  description: string;
  category: string;
  guidance?: Partial<Record<"1" | "2" | "3" | "4", string>>;
}[] = [
  { skillId: "skTypescript", name: "TypeScript", description: "Typede domenemodeller og trygge grensesnitt mellom tjenester.", category: "Frontend og klient", guidance: { "2": "Bruker typer aktivt i egne endringer.", "4": "Veileder andre i avanserte typemønstre." } },
  { skillId: "skReact", name: "React", description: "Komponentbasert utvikling med tilstand, effekter og testbare komponenter.", category: "Frontend og klient" },
  { skillId: "skTilgjengelighet", name: "Tilgjengelighet", description: "Universell utforming etter WCAG 2.2 AA i grensesnitt og skjemaer.", category: "Frontend og klient", guidance: { "3": "Kjenner WCAG-kravene og tester med verktøy." } },
  { skillId: "skApiDesign", name: "API-design", description: "Ressursorienterte API-er med stabile kontrakter, feilkoder og versjonering.", category: "Backend og API" },
  { skillId: "skIntegrasjon", name: "Systemintegrasjon", description: "Meldingsbaserte og synkrone integrasjoner mellom fagsystemer.", category: "Backend og API" },
  { skillId: "skDatamodellering", name: "Datamodellering", description: "Modellering av data med valideringsregler og tydelig eierskap.", category: "Backend og API" },
  { skillId: "skSystemarkitektur", name: "Systemarkitektur", description: "Helhetlige løsningsbeskrivelser og begrunnede arkitekturvalg.", category: "Arkitektur og dokumentasjon" },
  { skillId: "skTekniskDok", name: "Teknisk dokumentasjon", description: "Oppdaterte beskrivelser av systemer, drift og beslutninger.", category: "Arkitektur og dokumentasjon" },
  { skillId: "skSkyplattform", name: "Skyplattform", description: "Drift og utvikling på skyplattform med isolerte miljøer og kontrollert tilgang.", category: "Plattform og drift" },
  { skillId: "skInfraKode", name: "Infrastruktur som kode", description: "Versjonerte, gjenbrukbare beskrivelser av infrastruktur og miljøer.", category: "Plattform og drift" },
  { skillId: "skCiCd", name: "CI/CD", description: "Automatisert bygg, test og utrulling i byggløypene.", category: "Plattform og drift" },
  { skillId: "skObservability", name: "Observability", description: "Strukturert logging, målinger og sporing som gir innsikt i tjenestene.", category: "Plattform og drift" },
  { skillId: "skHendelseshandtering", name: "Hendelseshåndtering", description: "Varsling, triage, kommunikasjon og læring etter hendelser.", category: "Plattform og drift" },
  { skillId: "skTestautomatisering", name: "Testautomatisering", description: "Enhets-, integrasjons- og ende-til-ende-tester som kjører stabilt.", category: "Kvalitet og testing" },
  { skillId: "skKodegjennomgang", name: "Kodegjennomgang", description: "Konstruktive gjennomganger som styrker kvalitet og kunnskapsdeling.", category: "Kvalitet og testing" },
  { skillId: "skDatakvalitet", name: "Datakvalitet", description: "Målbare kvalitetskrav, automatiserte kontroller og oppfølging.", category: "Kvalitet og testing" },
  { skillId: "skInfosikkerhet", name: "Informasjonssikkerhet", description: "Sikker utvikling etter OWASP, trusselmodellering og tilgangsstyring.", category: "Sikkerhet" },
  { skillId: "skAvhengigheter", name: "Sikkerhet i avhengigheter", description: "Oversikt over og oppfølging av sårbarheter i tredjepartskomponenter.", category: "Sikkerhet" },
  { skillId: "skTrusselmodellering", name: "Trusselmodellering", description: "Systematisk vurdering av trusler mot nye løsninger før utvikling.", category: "Sikkerhet" },
  { skillId: "skTekniskVeiledning", name: "Teknisk veiledning", description: "Strukturert veiledning og gode rammer for nye i teamet.", category: "Samarbeid og veiledning" },
  { skillId: "skKunnskapsdeling", name: "Kunnskapsdeling", description: "Interne workshops, dokumenterte læringsnotater og parprogrammering.", category: "Samarbeid og veiledning" },
  { skillId: "skProduktforstaelse", name: "Produktforståelse", description: "Forståelse av brukerbehov, lovverk og tjenestenes formål.", category: "Samarbeid og veiledning" },
  { skillId: "skStakeholder", name: "Kommunikasjon med interessenter", description: "Tydelig kommunikasjon om prioriteringer, risiko og konsekvenser.", category: "Samarbeid og veiledning" },
  { skillId: "skAgilLevering", name: "Agil levering", description: "Planlegging i små steg, oppfølging av milepæler og forbedring underveis.", category: "Samarbeid og veiledning" },
  { skillId: "skUtviklingsverktoy", name: "Utviklingsverktøy", description: "Effektiv bruk av editor, versjonskontroll og lokale utviklingsmiljøer.", category: "Plattform og drift" },
];

/** The persisted-shape fields of one catalog skill (name, description, category and guidance are sealed by the codec). */
export function teamSkillRecord(s: (typeof DEMO_TEAM_SKILLS)[number], teamId: string, asOf: Date, sortOrder: number) {
  assertValidAsOf(asOf);
  return {
    teamId,
    name: s.name,
    description: s.description,
    category: s.category,
    guidance: s.guidance ?? {},
    criteriaVersion: 1,
    active: true,
    sortOrder,
    createdAt: asOf,
    createdBy: DEMO_AUDIT_ACTOR,
    updatedAt: asOf,
    updatedBy: DEMO_AUDIT_ACTOR,
  };
}

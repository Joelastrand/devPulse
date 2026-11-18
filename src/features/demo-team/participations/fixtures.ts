import { DEMO_MEMBER_IDENTITIES } from "../identities/fixtures";
import { PARTICIPATION_NOTE_MAX_LENGTH } from "../../team-projects/domain/team-project-participation";
import { DEMO_TEAM_PROJECTS } from "../fixtures";

/**
 * Project participations of the fictional members (Phase D). Each entry links one fictional member to one of the six existing
 * demo projects. The domain has no role field: a participation carries `memberRef`, `projectId`, planned dates and an optional
 * note, so each professional role is stated in the sealed note. Notes are Norwegian Bokmål.
 *
 * Dates are offsets from the live project's own start date, clamped to its end date, so every interval lies inside its project.
 * The offsets are fixed, so reruns compute the same dates. Overlaps between members are allowed and expected.
 */

export interface DemoParticipation {
  participationId: string;
  projectId: string;
  uid: string;
  /** Days after the project's start date. */
  startOffsetDays: number;
  durationDays: number;
  note: string;
}

export const DEMO_PARTICIPATIONS: readonly DemoParticipation[] = Object.freeze([
  { participationId: "demo-participation-01", projectId: "demo-project-api", uid: "demo-member-02", startOffsetDays: 0, durationDays: 120, note: "Ansvar for kontraktene og domenelogikken i de migrerte API-ene." },
  { participationId: "demo-participation-02", projectId: "demo-project-api", uid: "demo-member-09", startOffsetDays: 0, durationDays: 60, note: "Arkitekturgjennomgang av versjonering og overgangsperioder." },
  { participationId: "demo-participation-03", projectId: "demo-project-api", uid: "demo-member-03", startOffsetDays: 30, durationDays: 90, note: "Migrering av konsumenter til de nye endepunktene." },
  { participationId: "demo-participation-04", projectId: "demo-project-api", uid: "demo-member-08", startOffsetDays: 45, durationDays: 75, note: "Kontraktstester for de versjonerte endepunktene." },
  { participationId: "demo-participation-05", projectId: "demo-project-api", uid: "demo-member-01", startOffsetDays: 60, durationDays: 60, note: "Frontend-klienter mot de nye API-ene." },
  { participationId: "demo-participation-06", projectId: "demo-project-devplatform", uid: "demo-member-05", startOffsetDays: 0, durationDays: 90, note: "Drift og utvikling av byggløypene og bufring av bygg." },
  { participationId: "demo-participation-07", projectId: "demo-project-devplatform", uid: "demo-member-08", startOffsetDays: 10, durationDays: 80, note: "Automatiserte tester i byggløypen." },
  { participationId: "demo-participation-08", projectId: "demo-project-devplatform", uid: "demo-member-06", startOffsetDays: 20, durationDays: 70, note: "Sikkerhetsskanning av avhengigheter i byggløypen." },
  { participationId: "demo-participation-09", projectId: "demo-project-devplatform", uid: "demo-member-03", startOffsetDays: 0, durationDays: 60, note: "Utviklingsmiljøer og verktøy for teamet." },
  { participationId: "demo-participation-10", projectId: "demo-project-access", uid: "demo-member-04", startOffsetDays: 0, durationDays: 45, note: "Brukerundersøkelser og WCAG-vurdering av skjemaflyter." },
  { participationId: "demo-participation-11", projectId: "demo-project-access", uid: "demo-member-01", startOffsetDays: 0, durationDays: 45, note: "Tilgjengelige komponenter i designsystemet." },
  { participationId: "demo-participation-12", projectId: "demo-project-access", uid: "demo-member-08", startOffsetDays: 5, durationDays: 40, note: "Automatiske tilgjengelighetstester for skjemaene." },
  { participationId: "demo-participation-13", projectId: "demo-project-observability", uid: "demo-member-05", startOffsetDays: 0, durationDays: 100, note: "Ansvar for varsling, målinger og runbooks." },
  { participationId: "demo-participation-14", projectId: "demo-project-observability", uid: "demo-member-06", startOffsetDays: 10, durationDays: 80, note: "Sikkerhetsvarsler fra tilgangsloggen." },
  { participationId: "demo-participation-15", projectId: "demo-project-observability", uid: "demo-member-07", startOffsetDays: 20, durationDays: 80, note: "Dataanalyse av hendelser og målinger over tid." },
  { participationId: "demo-participation-16", projectId: "demo-project-observability", uid: "demo-member-10", startOffsetDays: 0, durationDays: 100, note: "Koordinering av leveransen og oppfølging av interessenter." },
  { participationId: "demo-participation-17", projectId: "demo-project-dataquality", uid: "demo-member-07", startOffsetDays: 0, durationDays: 100, note: "Datapipeliner og kvalitetskontroller." },
  { participationId: "demo-participation-18", projectId: "demo-project-dataquality", uid: "demo-member-08", startOffsetDays: 20, durationDays: 80, note: "Automatiserte datakontroller i testoppsettet." },
  { participationId: "demo-participation-19", projectId: "demo-project-dataquality", uid: "demo-member-10", startOffsetDays: 0, durationDays: 110, note: "Oppfølging av prosjektet og læringspunkter." },
  { participationId: "demo-participation-20", projectId: "demo-project-dataquality", uid: "demo-member-02", startOffsetDays: 40, durationDays: 60, note: "Integrasjon mot datakatalogen." },
  { participationId: "demo-participation-21", projectId: "demo-project-delivery", uid: "demo-member-10", startOffsetDays: 0, durationDays: 120, note: "Ansvarlig for leveranseprosessen og milepæler." },
  { participationId: "demo-participation-22", projectId: "demo-project-delivery", uid: "demo-member-09", startOffsetDays: 10, durationDays: 80, note: "Arkitekturrevisjon av leveranseløypen." },
  { participationId: "demo-participation-23", projectId: "demo-project-delivery", uid: "demo-member-04", startOffsetDays: 30, durationDays: 60, note: "Tilgjengelighetskrav i leveranseprosessen." },
]);

const PARTICIPATION_ID_PATTERN = /^demo-participation-\d{2}$/;
const DAY_MS = 86_400_000;

export interface ParticipationFixtureProblem {
  category: "count" | "id" | "duplicate-id" | "project" | "member" | "duplicate-pair" | "note" | "offset";
  subject: string;
}

/** Offline validation of the participation fixtures. Never throws. */
export function validateDemoParticipations(
  participations: readonly DemoParticipation[] = DEMO_PARTICIPATIONS,
): ParticipationFixtureProblem[] {
  const problems: ParticipationFixtureProblem[] = [];
  if (participations.length < 18 || participations.length > 25) problems.push({ category: "count", subject: String(participations.length) });

  const projectIds = new Set(DEMO_TEAM_PROJECTS.map((p) => p.projectId));
  const uids = new Set(DEMO_MEMBER_IDENTITIES.map((i) => i.uid));
  const ids = new Set<string>();
  const pairs = new Set<string>();
  for (const p of participations) {
    if (!PARTICIPATION_ID_PATTERN.test(p.participationId)) problems.push({ category: "id", subject: p.participationId });
    if (ids.has(p.participationId)) problems.push({ category: "duplicate-id", subject: p.participationId });
    ids.add(p.participationId);
    if (!projectIds.has(p.projectId)) problems.push({ category: "project", subject: p.participationId });
    if (!uids.has(p.uid)) problems.push({ category: "member", subject: p.participationId });
    const pair = `${p.projectId}|${p.uid}`;
    if (pairs.has(pair)) problems.push({ category: "duplicate-pair", subject: p.participationId });
    pairs.add(pair);
    const note = p.note.trim();
    if (note.length === 0 || note.length > PARTICIPATION_NOTE_MAX_LENGTH || note !== p.note) {
      problems.push({ category: "note", subject: p.participationId });
    }
    if (!Number.isInteger(p.startOffsetDays) || p.startOffsetDays < 0 || !Number.isInteger(p.durationDays) || p.durationDays < 1) {
      problems.push({ category: "offset", subject: p.participationId });
    }
  }
  return problems;
}

function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Concrete planned interval of one participation, derived from its live project's dates. Returns `null` when the start
 * offset falls after the project's end (the caller reports that as a conflict instead of clamping silently).
 */
export function participationInterval(
  participation: DemoParticipation,
  project: { startDate: string; endDate: string },
): { startDate: string; endDate: string } | null {
  const startDate = addDays(project.startDate, participation.startOffsetDays);
  if (startDate > project.endDate) return null;
  const wanted = addDays(startDate, participation.durationDays - 1);
  return { startDate, endDate: wanted > project.endDate ? project.endDate : wanted };
}

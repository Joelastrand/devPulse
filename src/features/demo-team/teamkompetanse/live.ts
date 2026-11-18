import { isValidTeamSkillRecord, normalizeTeamSkillName, type TeamSkillRecord } from "../../team-owned-skills/domain/team-skill";
import { isValidTeamSkillAssessment, type TeamSkillAssessmentRecord } from "../../team-owned-skills/domain/team-skill-assessment";
import { openAssessmentDocument } from "../../team-owned-skills/server/assessment-level-codec";
import { openTeamSkillDocument } from "../../team-owned-skills/server/team-skill-codec";
import {
  hasSkillContributionField,
  readSkillContribution,
  simulatedContributionPatch,
  SIMULATED_CONTRIBUTION_UIDS,
} from "../../team-skills/domain/skill-contribution";
import { DEMO_TEAM_SKILLS } from "../team-catalog-fixtures";
import { buildTeamkompetansePlan, type PlannedAssessment, type PlannedConsent, type TeamkompetansePlan } from "./plan";

/**
 * Live Teamkompetanse seeder core. Pure with respect to its injected database and Auth reader, so classification and the
 * write path are testable against an in-memory fake. It never creates an Auth account, never changes a membership field
 * other than its consent field, and never overwrites an existing assessment.
 *
 * Catalog skills are resolved by name, never by assumed id: live `teamSkills` documents use generated ids and sealed content.
 */

export const TEAMKOMPETANSE_MAX_WRITES = 400;

/** Minimal structural views of the Admin Firestore and Auth APIs used here. */
export interface SeedSnapshot {
  exists: boolean;
  data(): unknown;
}
export interface SeedRef {
  readonly path: string;
}
export interface SeedDocument {
  readonly id: string;
  data(): unknown;
}
export interface SeedTransaction {
  get(ref: SeedRef): Promise<SeedSnapshot>;
  create(ref: SeedRef, data: object): unknown;
  update(ref: SeedRef, data: object): unknown;
}
export interface SeedDatabase {
  doc(path: string): SeedRef;
  get(ref: SeedRef): Promise<SeedSnapshot>;
  /** The team's catalog skill documents (`teamSkills` where `teamId` equals). Read-only. */
  teamSkillsOf(teamId: string): Promise<readonly SeedDocument[]>;
  runTransaction<T>(work: (tx: SeedTransaction) => Promise<T>): Promise<T>;
}
export interface SeedAuth {
  getUser(uid: string): Promise<{ uid: string; disabled: boolean }>;
}

/**
 * `create`: absent, so it will be written. `identical`: present and equal to the plan. `conflict`: present and different,
 * or the membership is missing or belongs to someone else. `unreadable`: present but not a valid record.
 */
export type ClassificationState = "create" | "identical" | "conflict" | "unreadable";

export interface TeamkompetanseCounts {
  create: number;
  identical: number;
  conflict: number;
  unreadable: number;
}

export interface TeamkompetanseReport {
  mode: "preflight" | "write";
  projectId: string;
  teamId: string;
  /** Category strings only. Never raw data, SDK text, or identifiers beyond the fixed fictional uids. */
  blockers: string[];
  /** Live catalog names that match no demo fixture skill. Catalog names only; reported so a mismatch is visible. */
  catalogUnmatchedNames: string[];
  plannedConsent: number;
  plannedAssessments: number;
  consent: TeamkompetanseCounts;
  assessments: TeamkompetanseCounts;
  written: { consent: number; assessments: number } | null;
  /** Read-only post-write counts: how many planned records now read back as `identical`. */
  verified: { consent: number; assessments: number } | null;
  ok: boolean;
}

export interface CatalogResolution {
  blockers: string[];
  /** Fixture skill id → the one live skill id that carries its name. Present only when there are no blockers. */
  liveSkillIdFor: ReadonlyMap<string, string>;
  unmatchedNames: string[];
}

type Reader = (ref: SeedRef) => Promise<SeedSnapshot>;

/** Converts Admin Firestore timestamps to Dates, so the shared validators see the same shape the app reads. */
export function mapTimestamps(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const field of ["createdAt", "updatedAt"]) {
    const value = out[field];
    if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
      out[field] = (value as { toDate(): Date }).toDate();
    }
  }
  return out;
}

/**
 * Resolves each demo fixture skill to exactly one live catalog skill by its name. Missing, ambiguous and unreadable skills
 * are blockers: nothing is guessed. Extra live skills that match no fixture are reported by name and do not block.
 */
export async function resolveLiveCatalog(input: { db: SeedDatabase; teamId: string }): Promise<CatalogResolution> {
  const docs = await input.db.teamSkillsOf(input.teamId);
  const fixtureByName = new Map(DEMO_TEAM_SKILLS.map((skill) => [normalizeTeamSkillName(skill.name), skill.skillId]));
  const blockers = new Set<string>();
  const idsByFixture = new Map<string, string[]>();
  const unmatchedNames: string[] = [];

  for (const doc of docs) {
    const opened = openTeamSkillDocument(doc.id, mapTimestamps(doc.data()));
    const name = typeof opened === "object" && opened !== null ? (opened as { name?: unknown }).name : undefined;
    if (typeof name !== "string") {
      blockers.add("catalog-skill-unreadable");
      continue;
    }
    const fixtureId = fixtureByName.get(normalizeTeamSkillName(name));
    if (fixtureId === undefined) {
      unmatchedNames.push(name);
      continue;
    }
    idsByFixture.set(fixtureId, [...(idsByFixture.get(fixtureId) ?? []), doc.id]);
  }

  const liveSkillIdFor = new Map<string, string>();
  for (const skill of DEMO_TEAM_SKILLS) {
    const ids = idsByFixture.get(skill.skillId) ?? [];
    if (ids.length === 0) blockers.add("catalog-skill-missing");
    else if (ids.length > 1) blockers.add("catalog-skill-ambiguous");
    else liveSkillIdFor.set(skill.skillId, ids[0]);
  }
  return { blockers: [...blockers], liveSkillIdFor, unmatchedNames };
}

/** The membership must be the planned member's own document in this team, and its consent field must match the plan. */
function classifyConsent(planned: PlannedConsent, teamId: string, snapshot: SeedSnapshot): ClassificationState {
  if (!snapshot.exists) return "conflict";
  const data = snapshot.data();
  if (typeof data !== "object" || data === null) return "conflict";
  const record = data as Record<string, unknown>;
  if (record.uid !== planned.uid || record.teamId !== teamId) return "conflict";
  if (!hasSkillContributionField(record)) return "create";
  const existing = readSkillContribution(data, { uid: planned.uid, teamId });
  if (existing === null) return "unreadable";
  const same =
    existing.origin === "simulated" &&
    existing.noticeVersion === planned.value.noticeVersion &&
    existing.consentedAt.getTime() === planned.value.consentedAt.getTime();
  return same ? "identical" : "conflict";
}

/** An assessment is compared in plaintext: ownership fields, criteria version and level must all match the plan. */
function classifyAssessment(planned: PlannedAssessment, teamId: string, snapshot: SeedSnapshot): ClassificationState {
  if (!snapshot.exists) return "create";
  const opened = openAssessmentDocument(planned.uid, teamId, planned.skillId, mapTimestamps(snapshot.data()));
  if (!isValidTeamSkillAssessment(opened, { uid: planned.uid, skillId: planned.skillId })) return "unreadable";
  const record = opened as TeamSkillAssessmentRecord;
  if (record.teamId !== teamId) return "conflict";
  return record.level === planned.level && record.criteriaVersion === plannedCriteriaVersion(planned) ? "identical" : "conflict";
}

function plannedCriteriaVersion(planned: PlannedAssessment): number {
  return typeof planned.data.criteriaVersion === "number" ? planned.data.criteriaVersion : Number.NaN;
}

interface Classified {
  blockers: string[];
  consentStates: Array<{ planned: PlannedConsent; state: ClassificationState }>;
  assessmentStates: Array<{ planned: PlannedAssessment; state: ClassificationState }>;
}

/** Read-only check of the team, the planned catalog skills, Auth state and the planned records. Used for preflight, inside the transaction and after writes. */
async function classifyAll(input: {
  plan: TeamkompetansePlan;
  auth: { getUser(uid: string): Promise<{ uid: string; disabled: boolean }> };
  read: Reader;
  refFor: (path: string) => SeedRef;
}): Promise<Classified> {
  const blockers: string[] = [];
  const teamId = input.plan.teamId;

  const team = await input.read(input.refFor(`teams/${teamId}`));
  if (!team.exists) blockers.push("team-missing");
  else if ((team.data() as { status?: unknown } | null)?.status !== "active") blockers.push("team-inactive");

  for (const skillId of input.plan.liveSkillIds) {
    const snapshot = await input.read(input.refFor(`teamSkills/${skillId}`));
    if (!snapshot.exists) {
      blockers.push("catalog-skill-missing-or-invalid");
      continue;
    }
    const opened = openTeamSkillDocument(skillId, mapTimestamps(snapshot.data()));
    if (!isValidTeamSkillRecord(opened, { teamId, skillId })) {
      blockers.push("catalog-skill-missing-or-invalid");
      continue;
    }
    const record = opened as TeamSkillRecord;
    if (record.active !== true || record.criteriaVersion !== 1) blockers.push("catalog-skill-inactive-or-other-criteria");
  }

  for (const uid of SIMULATED_CONTRIBUTION_UIDS) {
    try {
      const account = await input.auth.getUser(uid);
      if (account.uid !== uid || account.disabled !== true) blockers.push("auth-account-not-disabled");
    } catch {
      blockers.push("auth-account-missing");
    }
  }

  const consentStates = [];
  for (const planned of input.plan.consents) {
    consentStates.push({ planned, state: classifyConsent(planned, teamId, await input.read(input.refFor(`teamMemberships/${planned.membershipDocId}`))) });
  }
  const assessmentStates = [];
  for (const planned of input.plan.assessments) {
    assessmentStates.push({ planned, state: classifyAssessment(planned, teamId, await input.read(input.refFor(`teamSkillAssessments/${planned.docId}`))) });
  }

  if (consentStates.some(({ state }) => state === "conflict" || state === "unreadable")) blockers.push("consent-conflict-or-unreadable");
  if (assessmentStates.some(({ state }) => state === "conflict" || state === "unreadable")) blockers.push("assessment-conflict-or-unreadable");
  return { blockers: [...new Set(blockers)], consentStates, assessmentStates };
}

function countStates(states: ReadonlyArray<{ state: ClassificationState }>): TeamkompetanseCounts {
  const counts: TeamkompetanseCounts = { create: 0, identical: 0, conflict: 0, unreadable: 0 };
  for (const { state } of states) counts[state] += 1;
  return counts;
}

function emptyReport(base: { mode: "preflight" | "write"; projectId: string; teamId: string }, blockers: string[], unmatched: string[]): TeamkompetanseReport {
  return {
    ...base,
    blockers,
    catalogUnmatchedNames: unmatched,
    plannedConsent: 0,
    plannedAssessments: 0,
    consent: countStates([]),
    assessments: countStates([]),
    written: null,
    verified: null,
    ok: false,
  };
}

/**
 * Preflight (read-only) or write. A write runs one transaction only when the classification is blocker-free: it re-checks
 * inside the transaction, then creates assessments and updates only the consent field of each membership. It then reads
 * everything back and reports the planned records that now read as `identical`.
 */
export async function runTeamkompetanseSeed(input: {
  mode: "preflight" | "write";
  requiredProjectId: string;
  projectId: string;
  teamId: string;
  db: SeedDatabase;
  auth: { getUser(uid: string): Promise<{ uid: string; disabled: boolean }> };
}): Promise<TeamkompetanseReport> {
  const base = { mode: input.mode, projectId: input.projectId, teamId: input.teamId };
  if (input.projectId !== input.requiredProjectId) return emptyReport(base, ["project-mismatch"], []);

  const catalog = await resolveLiveCatalog({ db: input.db, teamId: input.teamId });
  if (catalog.blockers.length > 0) return emptyReport(base, catalog.blockers, catalog.unmatchedNames);

  const plan = buildTeamkompetansePlan({ teamId: input.teamId, liveSkillIdFor: catalog.liveSkillIdFor });
  const plannedCount = plan.consents.length + plan.assessments.length;
  if (plannedCount > TEAMKOMPETANSE_MAX_WRITES) return emptyReport(base, ["write-budget-exceeded"], catalog.unmatchedNames);

  const refFor = (path: string) => input.db.doc(path);
  const read: Reader = (ref) => input.db.get(ref);
  const preview = await classifyAll({ plan, auth: input.auth, read, refFor });
  const summary = {
    ...base,
    catalogUnmatchedNames: catalog.unmatchedNames,
    plannedConsent: plan.consents.length,
    plannedAssessments: plan.assessments.length,
    consent: countStates(preview.consentStates),
    assessments: countStates(preview.assessmentStates),
  };

  if (input.mode === "preflight" || preview.blockers.length > 0) {
    return { ...summary, blockers: preview.blockers, written: null, verified: null, ok: input.mode === "preflight" && preview.blockers.length === 0 };
  }

  const wrote = await input.db.runTransaction(async (tx) => {
    const inside = await classifyAll({ plan, auth: input.auth, read: (ref) => tx.get(ref), refFor });
    if (inside.blockers.length > 0) return { classified: inside, writtenConsent: 0, writtenAssessments: 0 };
    let writtenConsent = 0;
    let writtenAssessments = 0;
    for (const { planned, state } of inside.consentStates) {
      if (state !== "create") continue;
      tx.update(refFor(`teamMemberships/${planned.membershipDocId}`), simulatedContributionPatch({ uid: planned.uid, teamId: input.teamId }, planned.value.consentedAt));
      writtenConsent += 1;
    }
    for (const { planned, state } of inside.assessmentStates) {
      if (state !== "create") continue;
      tx.create(refFor(`teamSkillAssessments/${planned.docId}`), planned.data);
      writtenAssessments += 1;
    }
    return { classified: inside, writtenConsent, writtenAssessments };
  });
  if (wrote.classified.blockers.length > 0) {
    return { ...summary, blockers: wrote.classified.blockers, written: null, verified: null, ok: false };
  }
  if (wrote.writtenConsent + wrote.writtenAssessments === 0) {
    // Skip-identical: every planned record is already present and equal, so the run succeeds without writing.
    return {
      ...summary,
      blockers: [],
      written: { consent: 0, assessments: 0 },
      verified: {
        consent: wrote.classified.consentStates.filter(({ state }) => state === "identical").length,
        assessments: wrote.classified.assessmentStates.filter(({ state }) => state === "identical").length,
      },
      ok:
        wrote.classified.consentStates.every(({ state }) => state === "identical") &&
        wrote.classified.assessmentStates.every(({ state }) => state === "identical"),
    };
  }

  const after = await classifyAll({ plan, auth: input.auth, read, refFor });
  const verified = {
    consent: after.consentStates.filter(({ state }) => state === "identical").length,
    assessments: after.assessmentStates.filter(({ state }) => state === "identical").length,
  };
  return {
    ...summary,
    blockers: after.blockers,
    written: { consent: wrote.writtenConsent, assessments: wrote.writtenAssessments },
    verified,
    ok: after.blockers.length === 0 && verified.consent === plan.consents.length && verified.assessments === plan.assessments.length,
  };
}

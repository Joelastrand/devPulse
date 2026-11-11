import "server-only";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { verifyIdToken, type VerifiedIdentity, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../../teams/domain/app-admin";
import {
  requireGenuineMemberWith,
  requireTeamAdministratorWith,
  type GenuineMembershipReads,
} from "../../teams/domain/genuine-membership";
import {
  isValidTeamSkillRecord,
  isWellFormedTeamSkillId,
  normalizeTeamSkillName,
  parseCreateTeamSkillBody,
  parseSetTeamSkillLevelBody,
  parseUpdateTeamSkillBody,
  sameGuidance,
  TEAM_SKILLS_PER_TEAM_MAX,
  toStoredGuidance,
  type TeamSkillGuidance,
  type TeamSkillLevel,
  type TeamSkillRecord,
} from "../domain/team-skill";
import { isValidTeamSkillAssessment, toAssessmentRecord } from "../domain/team-skill-assessment";
import { getDefaultTeamSkillStore, type TeamSkillStore, type TeamSkillTx } from "./team-skill-store";

/** Team-readable definition. Never carries audit uids or any person's assessment. */
export interface TeamSkillView {
  skillId: string;
  name: string;
  description: string;
  category: string | null;
  guidance: TeamSkillGuidance;
  criteriaVersion: number;
  active: boolean;
  sortOrder: number;
}

/** The caller's own rating of one team skill. `outdated` means it was given under older criteria (SPEC §5). */
export interface OwnTeamSkillAssessmentView {
  skillId: string;
  level: TeamSkillLevel;
  criteriaVersion: number;
  outdated: boolean;
}

export type TeamSkillError =
  | AuthRefusal
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "skill_unavailable"
  | "not_found"
  | "limit_reached"
  | "duplicate_name"
  | "assessment_unreadable"
  | "read_failed"
  | "persistence_failed";

export interface TeamSkillDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  store?: TeamSkillStore;
  now?: () => Date;
}

export type ListTeamSkillsResult =
  | {
      ok: true;
      skills: TeamSkillView[];
      /** Whether the caller may create or edit definitions (superadmin or teamadmin of an active team). */
      canEdit: boolean;
      /** The caller's own ratings; empty when the caller is not a member (for example a superadmin). */
      own: OwnTeamSkillAssessmentView[];
      truncated: boolean;
    }
  | { ok: false; error: TeamSkillError };

export type TeamSkillWriteResult = { ok: true; skill: TeamSkillView } | { ok: false; error: TeamSkillError };

export type TeamSkillLevelWriteResult =
  | { ok: true; skillId: string; level: TeamSkillLevel; criteriaVersion: number }
  | { ok: false; error: TeamSkillError };

export type TeamSkillLevelClearResult = { ok: true; skillId: string; cleared: boolean } | { ok: false; error: TeamSkillError };

function toView(skillId: string, record: TeamSkillRecord): TeamSkillView {
  return {
    skillId,
    name: record.name,
    description: record.description,
    category: record.category,
    guidance: toStoredGuidance(record.guidance),
    criteriaVersion: record.criteriaVersion,
    active: record.active,
    sortOrder: record.sortOrder,
  };
}

/** Admin-or-member gates read through the same transaction the write uses (SPEC §4). */
function readsFrom(tx: TeamSkillTx): GenuineMembershipReads {
  return {
    getTeamStatus: (teamId) => tx.getTeamStatus(teamId),
    getMembership: (uid, teamId) => tx.getMembership(uid, teamId),
  };
}

function isAdminCheck(deps: TeamSkillDeps) {
  return (identity: VerifiedIdentity) => isAppAdmin(identity, { isSuperadmin: deps.isSuperadmin });
}

/** Parsed and validated team skills of one team. Any invalid stored document fails closed; nothing is repaired. */
type LoadedSkills = { ok: true; skills: Array<{ skillId: string; record: TeamSkillRecord }>; truncated: boolean } | { ok: false };

async function loadTeamSkills(tx: TeamSkillTx, teamId: string): Promise<LoadedSkills> {
  const raw = await tx.listSkills(teamId, TEAM_SKILLS_PER_TEAM_MAX + 1);
  const truncated = raw.length > TEAM_SKILLS_PER_TEAM_MAX;
  const skills: Array<{ skillId: string; record: TeamSkillRecord }> = [];
  for (const { id, data } of raw.slice(0, TEAM_SKILLS_PER_TEAM_MAX)) {
    if (!isValidTeamSkillRecord(data, { teamId, skillId: id })) return { ok: false };
    skills.push({ skillId: id, record: data });
  }
  return { ok: true, skills, truncated };
}

/** Skill ids in display order: active first, then by `sortOrder`, then by id (deterministic). */
function sortForDisplay(a: { skillId: string; record: TeamSkillRecord }, b: { skillId: string; record: TeamSkillRecord }): number {
  if (a.record.active !== b.record.active) return a.record.active ? -1 : 1;
  if (a.record.sortOrder !== b.record.sortOrder) return a.record.sortOrder - b.record.sortOrder;
  return a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0;
}

function hasActiveDuplicate(
  skills: ReadonlyArray<{ skillId: string; record: TeamSkillRecord }>,
  name: string,
  exceptSkillId: string | null,
): boolean {
  const key = normalizeTeamSkillName(name);
  return skills.some(
    ({ skillId, record }) => skillId !== exceptSkillId && record.active && normalizeTeamSkillName(record.name) === key,
  );
}

/** Reads one skill of a team for a person's own assessment; it must be valid, belong to the team and be active. */
async function readActiveTeamSkill(
  tx: TeamSkillTx,
  teamId: string,
  skillId: string,
): Promise<{ ok: true; record: TeamSkillRecord } | { ok: false; error: "skill_unavailable" }> {
  if (!isWellFormedTeamSkillId(skillId)) return { ok: false, error: "skill_unavailable" };
  const raw = await tx.getSkill(skillId);
  if (!isValidTeamSkillRecord(raw, { teamId, skillId }) || !raw.active) return { ok: false, error: "skill_unavailable" };
  return { ok: true, record: raw };
}

/**
 * Lists the team's skill definitions (SPEC §4). Any genuine member may read; a superadmin may read too; only an
 * administrator of an active team may edit (`canEdit`). Own ratings are returned only to a genuine member. No other
 * person's rating is ever read here.
 */
export async function listTeamSkills(
  idToken: string,
  teamId: string,
  deps: TeamSkillDeps = {},
): Promise<ListTeamSkillsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const identity = verified.identity;
  const store = deps.store ?? getDefaultTeamSkillStore();

  try {
    return await store.runTransaction<ListTeamSkillsResult>(async (tx) => {
      const reads = readsFrom(tx);
      const member = await requireGenuineMemberWith(identity, teamId, reads);
      if (!member.ok && member.error !== "forbidden") return { ok: false, error: member.error };

      const admin = await requireTeamAdministratorWith(identity, teamId, reads, isAdminCheck(deps));
      if (!member.ok && !admin.ok && admin.error === "forbidden") return { ok: false, error: "forbidden" };

      const loaded = await loadTeamSkills(tx, teamId);
      if (!loaded.ok) return { ok: false, error: "read_failed" };
      const ordered = [...loaded.skills].sort(sortForDisplay);
      const skills = ordered.map(({ skillId, record }) => toView(skillId, record));

      const own: OwnTeamSkillAssessmentView[] = [];
      if (member.ok) {
        const ratings = await tx.listOwnAssessments(identity.uid, teamId, TEAM_SKILLS_PER_TEAM_MAX * 2);
        const bySkill = new Map<string, unknown>();
        for (const { data } of ratings) {
          const skillId = typeof data === "object" && data !== null ? (data as Record<string, unknown>).skillId : undefined;
          if (typeof skillId !== "string" || !isValidTeamSkillAssessment(data, { uid: identity.uid, skillId })) {
            return { ok: false, error: "assessment_unreadable" };
          }
          bySkill.set(skillId, data);
        }
        for (const { skillId, record } of ordered) {
          const rating = bySkill.get(skillId);
          if (!isValidTeamSkillAssessment(rating, { uid: identity.uid, skillId })) continue;
          own.push({
            skillId,
            level: rating.level,
            criteriaVersion: rating.criteriaVersion,
            outdated: rating.criteriaVersion < record.criteriaVersion,
          });
        }
      }

      return { ok: true, skills, canEdit: admin.ok, own, truncated: loaded.truncated };
    });
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

/** Creates a team skill (SPEC §4.3). Administrators of an active team only; the name must not duplicate an active one. */
export async function createTeamSkill(
  idToken: string,
  teamId: string,
  body: unknown,
  deps: TeamSkillDeps = {},
): Promise<TeamSkillWriteResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const identity = verified.identity;
  const store = deps.store ?? getDefaultTeamSkillStore();
  const now = (deps.now ?? (() => new Date()))();

  try {
    return await store.runTransaction<TeamSkillWriteResult>(async (tx) => {
      const admin = await requireTeamAdministratorWith(identity, teamId, readsFrom(tx), isAdminCheck(deps));
      if (!admin.ok) return { ok: false, error: admin.error };

      const input = parseCreateTeamSkillBody(body);
      if (!input.ok) return input;

      const loaded = await loadTeamSkills(tx, teamId);
      if (!loaded.ok) return { ok: false, error: "read_failed" };
      if (loaded.truncated || loaded.skills.length >= TEAM_SKILLS_PER_TEAM_MAX) return { ok: false, error: "limit_reached" };
      if (hasActiveDuplicate(loaded.skills, input.value.name, null)) return { ok: false, error: "duplicate_name" };

      const sortOrder = loaded.skills.reduce((max, { record }) => Math.max(max, record.sortOrder + 1), 0);
      const record: TeamSkillRecord = {
        teamId,
        name: input.value.name,
        description: input.value.description,
        category: input.value.category,
        guidance: toStoredGuidance(input.value.guidance),
        criteriaVersion: 1,
        active: true,
        sortOrder,
        createdAt: now,
        createdBy: identity.uid,
        updatedAt: now,
        updatedBy: identity.uid,
      };
      const skillId = store.newSkillId();
      if (!isWellFormedTeamSkillId(skillId)) return { ok: false, error: "persistence_failed" };
      tx.putSkill(skillId, record);
      return { ok: true, skill: toView(skillId, record) };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/**
 * Edits a team skill (SPEC §4.4, §5). Any change to `guidance` bumps `criteriaVersion`, so existing ratings are flagged,
 * never silently reinterpreted. Reactivating or renaming an active skill re-checks duplicates.
 */
export async function updateTeamSkill(
  idToken: string,
  teamId: string,
  skillId: string,
  body: unknown,
  deps: TeamSkillDeps = {},
): Promise<TeamSkillWriteResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const identity = verified.identity;
  const store = deps.store ?? getDefaultTeamSkillStore();
  const now = (deps.now ?? (() => new Date()))();

  try {
    return await store.runTransaction<TeamSkillWriteResult>(async (tx) => {
      const admin = await requireTeamAdministratorWith(identity, teamId, readsFrom(tx), isAdminCheck(deps));
      if (!admin.ok) return { ok: false, error: admin.error };

      const input = parseUpdateTeamSkillBody(body);
      if (!input.ok) return input;
      if (!isWellFormedTeamSkillId(skillId)) return { ok: false, error: "not_found" };

      const raw = await tx.getSkill(skillId);
      // Another team's skill is reported exactly like a missing one: no existence oracle across teams.
      if (raw === undefined || (typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).teamId !== teamId)) {
        return { ok: false, error: "not_found" };
      }
      if (!isValidTeamSkillRecord(raw, { teamId, skillId })) return { ok: false, error: "persistence_failed" };
      const current = raw;

      const loaded = await loadTeamSkills(tx, teamId);
      if (!loaded.ok) return { ok: false, error: "read_failed" };

      const patch = input.value;
      const next: TeamSkillRecord = {
        ...current,
        name: patch.name ?? current.name,
        description: patch.description ?? current.description,
        category: patch.category !== undefined ? patch.category : current.category,
        guidance: patch.guidance !== undefined ? toStoredGuidance(patch.guidance) : current.guidance,
        sortOrder: patch.sortOrder ?? current.sortOrder,
        active: patch.active ?? current.active,
        updatedAt: now,
        updatedBy: identity.uid,
      };
      if (!sameGuidance(next.guidance, current.guidance)) next.criteriaVersion = current.criteriaVersion + 1;

      const becomesActive = next.active && (!current.active || normalizeTeamSkillName(next.name) !== normalizeTeamSkillName(current.name));
      if (becomesActive && hasActiveDuplicate(loaded.skills, next.name, skillId)) {
        return { ok: false, error: "duplicate_name" };
      }

      tx.putSkill(skillId, next);
      return { ok: true, skill: toView(skillId, next) };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/**
 * Sets the caller's own rating (SPEC §3.2, §4). Genuine members of an active team only. The rating is stored with the
 * skill's current `criteriaVersion`. Only one `levels` key changes.
 */
export async function setOwnTeamSkillLevel(
  idToken: string,
  teamId: string,
  skillId: string,
  body: unknown,
  deps: TeamSkillDeps = {},
): Promise<TeamSkillLevelWriteResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const identity = verified.identity;
  const store = deps.store ?? getDefaultTeamSkillStore();
  const now = (deps.now ?? (() => new Date()))();

  try {
    return await store.runTransaction<TeamSkillLevelWriteResult>(async (tx) => {
      const member = await requireGenuineMemberWith(identity, teamId, readsFrom(tx));
      if (!member.ok) return { ok: false, error: member.error };

      const input = parseSetTeamSkillLevelBody(body);
      if (!input.ok) return input;

      const skill = await readActiveTeamSkill(tx, teamId, skillId);
      if (!skill.ok) return skill;

      const existing = await tx.getAssessment(identity.uid, skillId);
      let createdAt = now;
      if (existing !== undefined) {
        if (!isValidTeamSkillAssessment(existing, { uid: identity.uid, skillId })) {
          return { ok: false, error: "assessment_unreadable" };
        }
        createdAt = existing.createdAt;
      }

      const criteriaVersion = skill.record.criteriaVersion;
      tx.putAssessment(
        toAssessmentRecord({
          uid: identity.uid,
          teamId,
          skillId,
          level: input.value.level,
          criteriaVersion,
          createdAt,
          updatedAt: now,
        }),
      );
      return { ok: true, skillId, level: input.value.level, criteriaVersion };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/**
 * Clears the caller's own rating of an active team skill. Idempotent: a missing rating is not an error. Ratings of
 * inactive skills are kept as history and cannot be removed here (SPEC §4.5).
 */
export async function clearOwnTeamSkillLevel(
  idToken: string,
  teamId: string,
  skillId: string,
  deps: TeamSkillDeps = {},
): Promise<TeamSkillLevelClearResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const identity = verified.identity;
  const store = deps.store ?? getDefaultTeamSkillStore();

  try {
    return await store.runTransaction<TeamSkillLevelClearResult>(async (tx) => {
      const member = await requireGenuineMemberWith(identity, teamId, readsFrom(tx));
      if (!member.ok) return { ok: false, error: member.error };

      const skill = await readActiveTeamSkill(tx, teamId, skillId);
      if (!skill.ok) return skill;

      const existing = await tx.getAssessment(identity.uid, skillId);
      if (existing === undefined) return { ok: true, skillId, cleared: false };
      if (!isValidTeamSkillAssessment(existing, { uid: identity.uid, skillId })) {
        return { ok: false, error: "assessment_unreadable" };
      }

      tx.deleteAssessment(identity.uid, skillId);
      return { ok: true, skillId, cleared: true };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

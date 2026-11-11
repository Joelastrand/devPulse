import "server-only";
import { authRefusalFor, type AuthRefusal } from "../../auth/server/auth-refusal";
import { verifyIdToken, type VerifiedIdentity } from "../../auth/server/verify-identity";
import {
  requireGenuineMemberWith,
  requireTeamAdministratorWith,
  type GenuineMembershipReads,
} from "../../teams/domain/genuine-membership";
import { isValidTeamSkillRecord, isWellFormedTeamSkillId, TEAM_SKILLS_PER_TEAM_MAX, type TeamSkillRecord } from "../domain/team-skill";
import {
  isValidTeamManualAssessment,
  parseManualAssessmentBody,
  type TeamManualAssessmentRecord,
} from "../domain/team-manual-assessment";
import { getDefaultTeamSkillStore, type TeamSkillStore, type TeamSkillTx } from "./team-skill-store";
import { isAppAdmin } from "../../teams/domain/app-admin";
import type { TeamSkillDeps } from "./manage-team-skills";
import type { TeamSkillLevel } from "../domain/team-skill";

/**
 * Team-readable collaborative assessment of one active team skill. It carries the agreed level, the optional note, when it
 * was entered and whether it was entered under older criteria. It never carries the administrator who entered it.
 */
export interface TeamManualAssessmentView {
  skillId: string;
  name: string;
  level: TeamSkillLevel;
  note: string | null;
  criteriaVersion: number;
  /** The skill's guidance changed after the level was entered. The level is kept and shown, not reinterpreted. */
  outdated: boolean;
  updatedAt: string;
}

export type TeamManualAssessmentError =
  | AuthRefusal
  | "forbidden"
  | "team_disabled"
  | "invalid_request"
  | "invalid_input"
  | "skill_unavailable"
  | "read_failed"
  | "persistence_failed";

export type ListTeamManualAssessmentsResult =
  | { ok: true; canEdit: boolean; assessments: TeamManualAssessmentView[] }
  | { ok: false; error: TeamManualAssessmentError };

export type TeamManualAssessmentWriteResult =
  | { ok: true; skillId: string; level: TeamSkillLevel; criteriaVersion: number }
  | { ok: false; error: TeamManualAssessmentError };

export type TeamManualAssessmentClearResult = { ok: true; skillId: string; cleared: boolean } | { ok: false; error: TeamManualAssessmentError };

function readsFrom(tx: TeamSkillTx): GenuineMembershipReads {
  return {
    getTeamStatus: (teamId) => tx.getTeamStatus(teamId),
    getMembership: (uid, teamId) => tx.getMembership(uid, teamId),
  };
}

function isAdminCheck(deps: TeamSkillDeps) {
  return (identity: VerifiedIdentity) => isAppAdmin(identity, { isSuperadmin: deps.isSuperadmin });
}

/** One active, valid skill of the team, or `null`. Inactive and foreign skills are never assessable. */
async function readActiveTeamSkill(
  tx: TeamSkillTx,
  teamId: string,
  skillId: string,
): Promise<{ ok: true; record: TeamSkillRecord } | { ok: false }> {
  if (!isWellFormedTeamSkillId(skillId)) return { ok: false };
  const raw = await tx.getSkill(skillId);
  if (!isValidTeamSkillRecord(raw, { teamId, skillId }) || !raw.active) return { ok: false };
  return { ok: true, record: raw };
}

/**
 * Lists the team's collaborative assessments of its active skills. Any genuine member, and any administrator, may read.
 * Inactive skills are omitted from the profile; their stored values are kept. Malformed stored values fail closed.
 */
export async function listTeamManualAssessments(
  idToken: string,
  teamId: string,
  deps: TeamSkillDeps = {},
): Promise<ListTeamManualAssessmentsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const identity = verified.identity;
  const store: TeamSkillStore = deps.store ?? getDefaultTeamSkillStore();

  try {
    return await store.runTransaction<ListTeamManualAssessmentsResult>(async (tx) => {
      const reads = readsFrom(tx);
      const member = await requireGenuineMemberWith(identity, teamId, reads);
      if (!member.ok && member.error !== "forbidden") return { ok: false, error: member.error };
      const admin = await requireTeamAdministratorWith(identity, teamId, reads, isAdminCheck(deps));
      if (!member.ok && !admin.ok) return { ok: false, error: "forbidden" };

      const rawSkills = await tx.listSkills(teamId, TEAM_SKILLS_PER_TEAM_MAX + 1);
      const skills = new Map<string, TeamSkillRecord>();
      for (const { id, data } of rawSkills.slice(0, TEAM_SKILLS_PER_TEAM_MAX)) {
        if (!isValidTeamSkillRecord(data, { teamId, skillId: id })) return { ok: false, error: "read_failed" };
        if (data.active) skills.set(id, data);
      }

      const rawAssessments = await tx.listManualAssessments(teamId, TEAM_SKILLS_PER_TEAM_MAX * 2);
      const assessments: TeamManualAssessmentView[] = [];
      for (const { id, data } of rawAssessments) {
        const skillId = typeof data === "object" && data !== null ? (data as { skillId?: unknown }).skillId : undefined;
        if (typeof skillId !== "string" || !isValidTeamManualAssessment(data, { docId: id, teamId })) {
          return { ok: false, error: "read_failed" };
        }
        const skill = skills.get(skillId);
        if (skill === undefined) continue;
        assessments.push({
          skillId,
          name: skill.name,
          level: data.level,
          note: data.note,
          criteriaVersion: data.criteriaVersion,
          outdated: data.criteriaVersion < skill.criteriaVersion,
          updatedAt: data.updatedAt.toISOString(),
        });
      }
      assessments.sort((a, b) => a.name.localeCompare(b.name, "nb") || (a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0));
      return { ok: true, canEdit: admin.ok, assessments };
    });
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

/** Records the team's agreed level for one active skill. Administrators of an active team only. */
export async function setTeamManualAssessment(
  idToken: string,
  teamId: string,
  skillId: string,
  body: unknown,
  deps: TeamSkillDeps = {},
): Promise<TeamManualAssessmentWriteResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const identity = verified.identity;
  const store: TeamSkillStore = deps.store ?? getDefaultTeamSkillStore();
  const now = (deps.now ?? (() => new Date()))();

  try {
    return await store.runTransaction<TeamManualAssessmentWriteResult>(async (tx) => {
      const admin = await requireTeamAdministratorWith(identity, teamId, readsFrom(tx), isAdminCheck(deps));
      if (!admin.ok) return { ok: false, error: admin.error };

      const input = parseManualAssessmentBody(body);
      if (!input.ok) return input;

      const skill = await readActiveTeamSkill(tx, teamId, skillId);
      if (!skill.ok) return { ok: false, error: "skill_unavailable" };

      const record: TeamManualAssessmentRecord = {
        teamId,
        skillId,
        level: input.value.level,
        note: input.value.note,
        criteriaVersion: skill.record.criteriaVersion,
        updatedAt: now,
        updatedBy: identity.uid,
      };
      tx.putManualAssessment(record);
      return { ok: true, skillId, level: record.level, criteriaVersion: record.criteriaVersion };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

/** Removes the team's agreed level for one skill. Administrators only. Idempotent. Works for inactive skills too. */
export async function clearTeamManualAssessment(
  idToken: string,
  teamId: string,
  skillId: string,
  deps: TeamSkillDeps = {},
): Promise<TeamManualAssessmentClearResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) return { ok: false, error: authRefusalFor(verified) };
  const identity = verified.identity;
  const store: TeamSkillStore = deps.store ?? getDefaultTeamSkillStore();

  if (!isWellFormedTeamSkillId(skillId)) return { ok: false, error: "skill_unavailable" };
  try {
    return await store.runTransaction<TeamManualAssessmentClearResult>(async (tx) => {
      const admin = await requireTeamAdministratorWith(identity, teamId, readsFrom(tx), isAdminCheck(deps));
      if (!admin.ok) return { ok: false, error: admin.error };
      const existing = await tx.getManualAssessment(teamId, skillId);
      if (existing === undefined) return { ok: true, skillId, cleared: false };
      if (!isValidTeamManualAssessment(existing, { docId: `${teamId}__${skillId}`, teamId })) {
        return { ok: false, error: "read_failed" };
      }
      tx.deleteManualAssessment(teamId, skillId);
      return { ok: true, skillId, cleared: true };
    });
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

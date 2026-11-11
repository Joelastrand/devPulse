import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";

/**
 * The `personal_data` erasure step (TASK-022; SPEC D1, AE-SI-6, I-1, I-2, I-3, I-4). It deletes the erased person's own
 * personal data: the skill profile (self-assessed levels), the user profile (display name), the personal development goals,
 * and the formal role assignment (I-4, `roleAssignments/{uid}`; the shared role definition is kept). These are raw
 * deletions. No validated shape is required, so a malformed document is still removed (BR-16). Deletion is idempotent, so a
 * retry after an interruption is safe.
 *
 * Order within a batch: skill profile, user profile, role assignment, then goals one page at a time. Each batch removes one
 * unit of data and reports `more`. `done` only when none is left. The port hides the store paths. The production adapter
 * (TASK-038) must cover the whole goals subtree, and its tests must assert that a delete
 * really removes the id it was given, so a silent no-op cannot make a page repeat.
 */

export interface PersonalDataErasurePort {
  skillProfileExists(uid: string): Promise<boolean>;
  deleteSkillProfile(uid: string): Promise<void>;
  userProfileExists(uid: string): Promise<boolean>;
  deleteUserProfile(uid: string): Promise<void>;
  /** I-4: the uid's formal role assignment document (`roleAssignments/{uid}`). Deletion never touches the shared role. */
  roleAssignmentExists(uid: string): Promise<boolean>;
  deleteRoleAssignment(uid: string): Promise<void>;
  /** Goal document ids of the uid, at most `limit`. */
  goalIds(uid: string, limit: number): Promise<string[]>;
  deleteGoal(uid: string, goalId: string): Promise<void>;
  /** Responsibility document ids of the uid's whole `responsibilities` subtree (I-17), at most `limit`. */
  responsibilityIds(uid: string, limit: number): Promise<string[]>;
  deleteResponsibility(uid: string, responsibilityId: string): Promise<void>;
  /** Achievement document ids of the uid's whole `achievements` subtree (I-18), at most `limit`. */
  achievementIds(uid: string, limit: number): Promise<string[]>;
  deleteAchievement(uid: string, achievementId: string): Promise<void>;
  /** I-19: team-skill rating document ids whose stored `uid` is the erased person, at most `limit`. */
  teamSkillAssessmentIds(uid: string, limit: number): Promise<string[]>;
  deleteTeamSkillAssessment(uid: string, assessmentId: string): Promise<void>;
}

export interface PersonalDataStepDeps {
  readonly port: PersonalDataErasurePort;
}

export function createPersonalDataStepHandler(deps: PersonalDataStepDeps): StepHandler {
  return {
    runBatch: ({ uid, maxWrites }) => runPersonalDataBatch(deps, uid, maxWrites),
  };
}

export async function runPersonalDataBatch(deps: PersonalDataStepDeps, uid: string, maxWrites: number): Promise<BatchResult> {
  // A zero budget could report "done" while data remains, so it is a programming error, not a batch result.
  if (maxWrites < 1) throw new ErasureStepFailure("unexpected");
  const { port } = deps;

  if (await port.skillProfileExists(uid)) {
    await port.deleteSkillProfile(uid);
    return "more";
  }
  if (await port.userProfileExists(uid)) {
    await port.deleteUserProfile(uid);
    return "more";
  }
  if (await port.roleAssignmentExists(uid)) {
    await port.deleteRoleAssignment(uid);
    return "more";
  }

  const goals = await port.goalIds(uid, maxWrites);
  if (goals.length > 0) {
    for (const goalId of goals) {
      await port.deleteGoal(uid, goalId);
    }
    return "more";
  }

  // I-17 and I-18 (SECURITY-REVIEW §11.3): path-only deletion, no decryption, so no key is needed.
  const responsibilities = await port.responsibilityIds(uid, maxWrites);
  if (responsibilities.length > 0) {
    for (const responsibilityId of responsibilities) {
      await port.deleteResponsibility(uid, responsibilityId);
    }
    return "more";
  }

  const achievements = await port.achievementIds(uid, maxWrites);
  if (achievements.length > 0) {
    for (const achievementId of achievements) {
      await port.deleteAchievement(uid, achievementId);
    }
    return "more";
  }

  // I-19 (team-owned skills, SPEC §7): the person's private team-skill ratings, one document each.
  const teamAssessments = await port.teamSkillAssessmentIds(uid, maxWrites);
  if (teamAssessments.length > 0) {
    for (const assessmentId of teamAssessments) {
      await port.deleteTeamSkillAssessment(uid, assessmentId);
    }
    return "more";
  }

  return "done";
}

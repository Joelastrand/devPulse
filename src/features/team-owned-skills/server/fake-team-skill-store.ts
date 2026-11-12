import type { TeamSkillRecord } from "../domain/team-skill";
import { teamSkillAssessmentDocId, type TeamSkillAssessmentRecord } from "../domain/team-skill-assessment";
import { teamManualAssessmentDocId, type TeamManualAssessmentRecord } from "../domain/team-manual-assessment";
import type { RawDoc, TeamSkillStore, TeamSkillTx } from "./team-skill-store";

type Doc = Record<string, unknown>;

export interface FakeTeamSkillState {
  teams: Record<string, unknown>;
  /** Keyed by `uid__teamId`. */
  memberships: Record<string, Doc>;
  /** Keyed by skill id. Raw data, so tests can plant malformed documents. */
  skills: Record<string, unknown>;
  /** Keyed by `uid__skillId`. Raw data, so tests can plant malformed documents. */
  assessments: Record<string, Doc>;
  /** Keyed by `teamId__skillId`. Raw data, so tests can plant malformed documents. */
  manualAssessments?: Record<string, Doc>;
}

/**
 * In-memory `TeamSkillStore` for tests. Operations write immediately, which is safe because every operation performs its
 * reads before its first write, as production does.
 */
export function createFakeTeamSkillStore(initial: Partial<FakeTeamSkillState> = {}) {
  const state: FakeTeamSkillState = {
    teams: { ...(initial.teams ?? {}) },
    memberships: { ...(initial.memberships ?? {}) },
    skills: { ...(initial.skills ?? {}) },
    assessments: { ...(initial.assessments ?? {}) },
    manualAssessments: { ...(initial.manualAssessments ?? {}) },
  };
  let counter = 0;

  const tx: TeamSkillTx = {
    async getTeamStatus(teamId) {
      return state.teams[teamId] && (state.teams[teamId] as Doc).status;
    },
    async getMembership(uid, teamId) {
      return state.memberships[`${uid}__${teamId}`];
    },
    async listSkills(teamId, limit) {
      const docs: RawDoc[] = Object.entries(state.skills)
        .filter(([, data]) => typeof data === "object" && data !== null && (data as Doc).teamId === teamId)
        .map(([id, data]) => ({ id, data }));
      return docs.slice(0, limit);
    },
    async getSkill(skillId) {
      return state.skills[skillId];
    },
    putSkill(skillId, record: TeamSkillRecord) {
      state.skills[skillId] = { ...record };
    },
    async getAssessment(uid, _teamId, skillId) {
      const doc = state.assessments[teamSkillAssessmentDocId(uid, skillId)];
      return doc && { ...doc };
    },
    async listOwnAssessments(uid, teamId, limit) {
      return Object.entries(state.assessments)
        .filter(([, data]) => data.uid === uid && data.teamId === teamId)
        .slice(0, limit)
        .map(([id, data]) => ({ id, data: { ...data } }));
    },
    putAssessment(record: TeamSkillAssessmentRecord) {
      state.assessments[teamSkillAssessmentDocId(record.uid, record.skillId)] = { ...record };
    },
    deleteAssessment(uid, skillId) {
      delete state.assessments[teamSkillAssessmentDocId(uid, skillId)];
    },
    async getManualAssessment(teamId, skillId) {
      const doc = state.manualAssessments?.[teamManualAssessmentDocId(teamId, skillId)];
      return doc && { ...doc };
    },
    async listManualAssessments(teamId, limit) {
      return Object.entries(state.manualAssessments ?? {})
        .filter(([, data]) => data.teamId === teamId)
        .slice(0, limit)
        .map(([id, data]) => ({ id, data: { ...data } }));
    },
    putManualAssessment(record: TeamManualAssessmentRecord) {
      state.manualAssessments = { ...(state.manualAssessments ?? {}), [teamManualAssessmentDocId(record.teamId, record.skillId)]: { ...record } };
    },
    deleteManualAssessment(teamId, skillId) {
      const next = { ...(state.manualAssessments ?? {}) };
      delete next[teamManualAssessmentDocId(teamId, skillId)];
      state.manualAssessments = next;
    },
  };

  const store: TeamSkillStore = {
    newSkillId() {
      counter += 1;
      return `skill${String(counter).padStart(4, "0")}`;
    },
    async runTransaction(work) {
      return work(tx);
    },
  };

  return { store, state };
}

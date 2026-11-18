import { isTeamSkillLevel, type TeamSkillLevel } from "../../team-owned-skills/domain/team-skill";
import { teamSkillAssessmentDocId } from "../../team-owned-skills/domain/team-skill-assessment";
import { sealAssessmentLevel } from "../../team-owned-skills/server/assessment-level-codec";
import { SIMULATED_CONTRIBUTION_TEAM_ID, SIMULATED_CONTRIBUTION_UIDS } from "../../team-skills/domain/skill-contribution";
import { SKILL_CONTRIBUTION_NOTICE_VERSION } from "../../team-skills/domain/skill-coverage-policy";
import { membershipDocId } from "../../teams/domain/team-membership";
import { DEMO_TEAM_SKILLS } from "../team-catalog-fixtures";
import {
  TEAMKOMPETANSE_AS_OF,
  TEAMKOMPETANSE_CONSENT_AS_OF,
  TEAMKOMPETANSE_CRITERIA_VERSION,
  TEAMKOMPETANSE_PROFILES,
} from "./fixtures";

/** One `teamSkillAssessments/{uid}__{skillId}` document to create. `level` in `data` is the sealed envelope, never plaintext. */
export interface PlannedAssessment {
  uid: string;
  /** The live catalog skill id (generated), resolved by name. Never a fixture id. */
  skillId: string;
  level: TeamSkillLevel;
  docId: string;
  data: Record<string, unknown>;
}

/** The consent to add to one existing membership. The write is a narrow field patch: nothing else on the membership changes. */
export interface PlannedConsent {
  uid: string;
  membershipDocId: string;
  value: { noticeVersion: number; consentedAt: Date };
}

export interface TeamkompetansePlan {
  teamId: string;
  consents: readonly PlannedConsent[];
  assessments: readonly PlannedAssessment[];
  /** The distinct live catalog skill ids the plan references. */
  liveSkillIds: readonly string[];
}

export type SealLevel = (uid: string, teamId: string, skillId: string, level: TeamSkillLevel) => unknown;

const CATALOG_SKILL_IDS: ReadonlySet<string> = new Set(DEMO_TEAM_SKILLS.map((skill) => skill.skillId));

/**
 * Pure plan of the synthetic Teamkompetanse seed. Refuses anything outside the designated demo team, the ten fixed fictional
 * uids and the demo catalog, and every fixture skill must resolve to a live catalog skill id. The seal is injected so tests
 * can run with a stub; production uses the record codec.
 */
export function buildTeamkompetansePlan(input: {
  teamId: string;
  liveSkillIdFor: ReadonlyMap<string, string>;
  seal?: SealLevel;
}): TeamkompetansePlan {
  if (input.teamId !== SIMULATED_CONTRIBUTION_TEAM_ID) throw new Error("plan: team is not the designated demo team");
  const seal: SealLevel = input.seal ?? ((uid, teamId, skillId, level) => sealAssessmentLevel(uid, teamId, skillId, level));
  const allowedUids = new Set<string>(SIMULATED_CONTRIBUTION_UIDS);
  const profileUids = new Set<string>();

  const consents: PlannedConsent[] = [];
  const assessments: PlannedAssessment[] = [];
  for (const profile of TEAMKOMPETANSE_PROFILES) {
    if (!allowedUids.has(profile.uid) || profileUids.has(profile.uid)) throw new Error("plan: profile uid not allowed or duplicated");
    profileUids.add(profile.uid);
    consents.push({
      uid: profile.uid,
      membershipDocId: membershipDocId(profile.uid, input.teamId),
      value: { noticeVersion: SKILL_CONTRIBUTION_NOTICE_VERSION, consentedAt: TEAMKOMPETANSE_CONSENT_AS_OF },
    });
    for (const [fixtureSkillId, level] of Object.entries(profile.ratings)) {
      if (level === undefined) continue;
      if (!CATALOG_SKILL_IDS.has(fixtureSkillId)) throw new Error("plan: skill is not in the demo catalog");
      if (!isTeamSkillLevel(level)) throw new Error("plan: level outside the supported scale");
      const skillId = input.liveSkillIdFor.get(fixtureSkillId);
      if (skillId === undefined) throw new Error("plan: fixture skill has no resolved live catalog skill");
      const envelope = seal(profile.uid, input.teamId, skillId, level);
      assessments.push({
        uid: profile.uid,
        skillId,
        level,
        docId: teamSkillAssessmentDocId(profile.uid, skillId),
        data: {
          uid: profile.uid,
          teamId: input.teamId,
          skillId,
          level: envelope,
          criteriaVersion: TEAMKOMPETANSE_CRITERIA_VERSION,
          createdAt: TEAMKOMPETANSE_AS_OF,
          updatedAt: TEAMKOMPETANSE_AS_OF,
        },
      });
    }
  }
  if (profileUids.size !== SIMULATED_CONTRIBUTION_UIDS.length) throw new Error("plan: every fictional member needs a profile");
  const liveSkillIds = [...new Set(assessments.map((a) => a.skillId))];
  return { teamId: input.teamId, consents, assessments, liveSkillIds };
}

import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { isValidTeamSkillAssessment, teamSkillAssessmentDocId } from "../domain/team-skill-assessment";
import { TEAM_SKILL_LEVELS } from "../domain/team-skill";
import { TEAM_SKILL_ASSESSMENTS_COLLECTION } from "./team-skill-store";

/** Documents per Admin SDK `getAll` call. Bounds one request, not the total. */
const GET_ALL_CHUNK = 300;

export interface TeamSkillRatingTarget {
  skillId: string;
  /** The skill's current criteria version. Ratings given under any other version are excluded, never mixed in. */
  criteriaVersion: number;
}

/**
 * Per skill: the valid levels (1–4) of the eligible contributors at the current criteria version, sorted ascending, and
 * `suspect` when any eligible contributor's stored rating for that skill was unreadable or inconsistent. A suspect skill
 * must not be derived from (fail closed); the caller suppresses it.
 */
export interface TeamSkillRatingTally {
  levels: number[];
  suspect: boolean;
}

export type ReadTeamSkillRatingsBatchResult = { ok: true; bySkill: Map<string, TeamSkillRatingTally> } | { ok: false };

/** Reads one raw document per (uid, skill) pair. Injected in tests; production uses `getAll` on exact document ids. */
export type ReadRawAssessments = (
  keys: ReadonlyArray<{ uid: string; skillId: string }>,
) => Promise<ReadonlyArray<unknown | undefined>>;

export interface ReadTeamSkillRatingsBatchDeps {
  readRaw?: ReadRawAssessments;
}

/** Date-valued fields are mapped from Firestore timestamps before validation. */
function mapTimestamps(data: unknown): unknown {
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

const defaultReadRaw: ReadRawAssessments = async (keys) => {
  const db = getFirestoreDb();
  const out: unknown[] = [];
  for (let start = 0; start < keys.length; start += GET_ALL_CHUNK) {
    const refs = keys
      .slice(start, start + GET_ALL_CHUNK)
      .map(({ uid, skillId }) => db.collection(TEAM_SKILL_ASSESSMENTS_COLLECTION).doc(teamSkillAssessmentDocId(uid, skillId)));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) out.push(snapshot.exists ? mapTimestamps(snapshot.data()) : undefined);
  }
  return out;
};

/**
 * Identity-free ratings for a caller-supplied set of people and team skills (the team-owned counterpart of the
 * personal-skill batch reader in skill-profiles). The caller decides eligibility (opt-in, membership, active team); this reader only reads the
 * exact `teamSkillAssessments/{uid}__{skillId}` documents of those people and never queries across people.
 *
 * Per document: an absent document is simply not a rating. A document that is present but fails the stored-rating
 * validation, whose `teamId` differs from the team, or whose `criteriaVersion` is not a valid integer marks the skill
 * `suspect`. A rating at another (older) criteria version is excluded without marking the skill suspect. Output carries
 * no uid, document id, or input order. Any read failure returns `{ ok: false }`.
 */
export async function readTeamSkillRatingsBatch(
  uids: readonly string[],
  teamId: string,
  targets: readonly TeamSkillRatingTarget[],
  deps: ReadTeamSkillRatingsBatchDeps = {},
): Promise<ReadTeamSkillRatingsBatchResult> {
  const uniqueUids = [...new Set(uids)];
  const uniqueTargets = [...new Map(targets.map((target) => [target.skillId, target])).values()];
  const bySkill = new Map<string, TeamSkillRatingTally>(
    uniqueTargets.map((target) => [target.skillId, { levels: [], suspect: false }]),
  );
  if (uniqueUids.length === 0 || uniqueTargets.length === 0) return { ok: true, bySkill };

  const keys = uniqueUids.flatMap((uid) => uniqueTargets.map((target) => ({ uid, skillId: target.skillId })));
  let documents: ReadonlyArray<unknown | undefined>;
  try {
    documents = await (deps.readRaw ?? defaultReadRaw)(keys);
  } catch {
    return { ok: false };
  }
  if (documents.length !== keys.length) return { ok: false };

  keys.forEach(({ uid, skillId }, index) => {
    const raw = documents[index];
    if (raw === undefined) return;
    const tally = bySkill.get(skillId);
    const target = uniqueTargets.find((candidate) => candidate.skillId === skillId);
    if (!tally || !target) return;
    if (!isValidTeamSkillAssessment(raw, { uid, skillId })) {
      tally.suspect = true;
      return;
    }
    const record = raw;
    if (record.teamId !== teamId) {
      tally.suspect = true;
      return;
    }
    if (record.criteriaVersion !== target.criteriaVersion) return;
    if (!(TEAM_SKILL_LEVELS as readonly number[]).includes(record.level)) {
      tally.suspect = true;
      return;
    }
    tally.levels.push(record.level);
  });

  for (const tally of bySkill.values()) tally.levels.sort((a, b) => a - b);
  return { ok: true, bySkill };
}

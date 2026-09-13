/**
 * A Firestore `surveyParticipations` document (docs/features/
 * managed-surveys/SPEC.md — "Authentication vs anonymity distinction").
 * Exists only for `authenticated`-mode surveys, used exclusively to detect
 * a second accepted submission from the same identity (BR-21/BR-22).
 * Deliberately minimal — no `submittedAt` and no other field — so it shares
 * no content with the `SurveyResponse` document it accompanies (BR-18); see
 * SPEC → "Consistency vs. unlinkability tradeoff" for why even a shared
 * timestamp field is avoided.
 */
export interface SurveyParticipationRecord {
  uid: string;
  surveyId: string;
}

/**
 * Builds the deterministic `surveyParticipations` document id for one
 * (uid, surveyId) pair — mirrors `teamMemberships`'s own
 * `membershipDocId` scheme. A deterministic id is what makes the duplicate
 * check (BR-22) a direct document read/transactional-create, needing no
 * query or composite index at all.
 */
export function participationDocId(uid: string, surveyId: string): string {
  return `${uid}__${surveyId}`;
}

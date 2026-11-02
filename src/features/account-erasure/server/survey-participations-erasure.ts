import { ErasureStepFailure, type BatchResult, type StepHandler } from "./erasure-runner";

/**
 * The `survey_participations` erasure step (TASK-021; SPEC BR-11, D6, AE-SI-8, I-12, P-1). It deletes the erased person's
 * `surveyParticipations` documents, including open authenticated surveys. It does NOT read, join, or write anonymous
 * `surveyResponses` (P-1, preserved). The port has no response-store access at all, so that is enforced by construction.
 *
 * Ownership: a document belongs to the uid when its `uid` field equals the uid. A legacy document with no `uid` field belongs
 * to the uid only when its id is exactly `${uid}__${surveyId}` for its own `surveyId` string (the document id scheme). A
 * document whose `uid` belongs to someone else, a malformed field, or an unattributable legacy id fails closed with
 * `verification_failed` and writes nothing. Each batch deletes one document in a transaction that re-reads it and re-checks
 * ownership. A listed id with no record also fails closed. `done` only when none is left.
 */

export interface SurveyParticipationTransaction {
  getParticipation(participationId: string): Promise<unknown>;
  deleteParticipation(participationId: string): void;
}

export interface SurveyParticipationsErasurePort {
  runTransaction<T>(work: (tx: SurveyParticipationTransaction) => Promise<T>): Promise<T>;
  /**
   * Participation ids that may belong to the uid, at most `limit`: documents whose `uid` field is the uid, or ids with the
   * legacy `uid__` prefix. The step attributes each listed id exactly (see `isOwnedBy`). A listed id that is not owned, or
   * that has no record, fails closed as `verification_failed` and blocks erasure until it is resolved by an operator. A
   * production adapter must therefore list legacy ids with an exact-id filter where it can, so a foreign prefix match does
   * not block the step permanently.
   */
  participationIdsFor(uid: string, limit: number): Promise<string[]>;
}

export interface SurveyParticipationsStepDeps {
  readonly port: SurveyParticipationsErasurePort;
}

export function createSurveyParticipationsStepHandler(deps: SurveyParticipationsStepDeps): StepHandler {
  return {
    runBatch: ({ uid, maxWrites }) => runSurveyParticipationsBatch(deps, uid, maxWrites),
  };
}

export async function runSurveyParticipationsBatch(
  deps: SurveyParticipationsStepDeps,
  uid: string,
  maxWrites: number,
): Promise<BatchResult> {
  // A zero budget could report "done" while a participation remains, so it is a programming error, not a batch result.
  if (maxWrites < 1) throw new ErasureStepFailure("unexpected");

  const [next] = await deps.port.participationIdsFor(uid, 1);
  if (next === undefined) return "done";

  await deps.port.runTransaction(async (tx) => {
    const raw = await tx.getParticipation(next);
    // A listed id with no record is inconsistent with the listing. Fail closed; a record that really was removed is no
    // longer listed on the next request, so the step proceeds then. Nothing is deleted.
    if (raw === undefined) throw new ErasureStepFailure("verification_failed");

    if (!isOwnedBy(raw, next, uid)) throw new ErasureStepFailure("verification_failed");
    tx.deleteParticipation(next);
  });
  return "more";
}

/**
 * True only when the record is attributable to the erased uid. A `uid` field must equal the uid. A legacy record with no
 * `uid` field is owned only when its id is exactly `${uid}__${surveyId}` for its own `surveyId` field. Matching the whole
 * id, not a prefix, means a uid that contains `__` cannot make another person's legacy id match. Anything else fails closed.
 */
function isOwnedBy(raw: unknown, participationId: string, uid: string): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  if (record.uid !== undefined) return record.uid === uid;
  return typeof record.surveyId === "string" && participationId === `${uid}__${record.surveyId}`;
}

import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { effectiveLifecycle, isValidSurvey, type Survey } from "../domain/survey";
import { type AuthRefusal } from "../../auth/server/auth-refusal";
import { runFencedTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
const SURVEYS_COLLECTION = "surveys";
const SURVEY_RESPONSES_COLLECTION = "surveyResponses";

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface DeleteOrArchiveSurveyDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The read/write seam for the target `surveys/{surveyId}` document itself,
 * satisfied in production by direct Firestore document calls and by an
 * in-memory fake in tests. Kept as its own local seam per this codebase's
 * established one-seam-per-operation convention (`create-survey.ts`'s
 * `SurveysCollection`, `open-survey.ts`'s `OpenSurveyDb`) rather than a new
 * shared abstraction.
 */
export interface SurveyDocStore {
  get(surveyId: string): Promise<DeleteOrArchiveSurveyDocSnapshot>;
  delete(surveyId: string): Promise<void>;
  setArchivedAt(surveyId: string, archivedAt: Date): Promise<void>;
}

/** Writer-only: the delete and the archive stamp are fenced on `accountErasures/{actorUid}` in the same transaction (TASK-034, W-17). */
export function getDefaultSurveyDocStore(actorUid: string): SurveyDocStore {
  return {
    async get(surveyId) {
      const snapshot = await getFirestoreDb().collection(SURVEYS_COLLECTION).doc(surveyId).get();
      return { exists: snapshot.exists, data: () => snapshot.data() };
    },
    async delete(surveyId) {
      const db = getFirestoreDb();
      await runFencedTransaction(db, actorUid, async (tx) => {
        tx.delete(db.collection(SURVEYS_COLLECTION).doc(surveyId));
      });
    },
    async setArchivedAt(surveyId, archivedAt) {
      const db = getFirestoreDb();
      await runFencedTransaction(db, actorUid, async (tx) => {
        tx.update(db.collection(SURVEYS_COLLECTION).doc(surveyId), { archivedAt });
      });
    },
  };
}

/**
 * The read seam for "does this survey have any responses at all" — a plain
 * existence check (`limit(1)`), never a full count or any decrypted
 * content, satisfied in production by a Firestore query and by an
 * in-memory fake in tests.
 */
export interface SurveyResponsesExistenceReader {
  hasAnyResponses(surveyId: string): Promise<boolean>;
}

export function getDefaultResponsesExistenceReader(): SurveyResponsesExistenceReader {
  return {
    async hasAnyResponses(surveyId) {
      const snapshot = await getFirestoreDb()
        .collection(SURVEY_RESPONSES_COLLECTION)
        .where("surveyId", "==", surveyId)
        .limit(1)
        .get();
      return !snapshot.empty;
    },
  };
}

/** Maps raw Firestore document data (Timestamp fields included) into the candidate shape `isValidSurvey` expects. */
function toCandidateSurvey(surveyId: string, data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  return {
    ...record,
    surveyId,
    startAt: toDateOrUndefined(record.startAt),
    endAt: toDateOrUndefined(record.endAt),
    openedAt: toDateOrUndefined(record.openedAt),
    closedAt: toDateOrUndefined(record.closedAt),
    archivedAt: toDateOrUndefined(record.archivedAt),
    createdAt: toDateOrUndefined(record.createdAt),
  };
}

function toDateOrUndefined(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  // Left as-is (not a Date) so `isValidSurvey`'s `isValidDate` check fails
  // closed on it, rather than silently coercing an unexpected shape.
  return value;
}

export type DeleteOrArchiveSurveyOutcome = "deleted" | "archived";

export type DeleteOrArchiveSurveyResult =
  | { ok: true; outcome: DeleteOrArchiveSurveyOutcome }
  | {
      ok: false;
      error:
        | AuthRefusal
        | "forbidden"
        | "survey_not_found"
        | "wrong_team"
        | "not_closed"
        | "persistence_failed";
    };

export interface DeleteOrArchiveSurveyDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  isSuperadmin?: IsAppAdminDeps["isSuperadmin"];
  surveyDocs?: SurveyDocStore;
  responses?: SurveyResponsesExistenceReader;
}

/**
 * Permanently deletes a closed, zero-response survey, or archives a closed
 * survey that has one or more responses — the choice is always
 * server-determined by response count, never a free client choice
 * (docs/features/managed-surveys/SPEC.md — BR-35, BR-36, BR-37). Only an
 * app admin may call this successfully — reuses `requireAppAdmin`
 * unchanged.
 *
 * `teamId` is always the caller's own trusted server/route scope (mirrors
 * `createSurvey`/`openSurvey`) and is cross-checked against the fetched
 * survey's own persisted `teamId` (`wrong_team` on mismatch) — a survey
 * belonging to another team is never mutated through this team's admin
 * route.
 *
 * Neither action is available unless the survey's derived lifecycle is
 * `closed` (BR-37) — rejected as `not_closed` for `scheduled`/`open`,
 * so a survey can never be hidden from active views while still
 * technically answerable. No additional race-guarding is needed for "a
 * response arrives concurrently with delete": `submitSurveyResponse`
 * already refuses any survey that isn't `open` (BR-20), so once a survey
 * is `closed` its response count can never change again — there is no
 * window where a genuinely zero-response survey could gain one between
 * this function's existence check and its delete/archive write.
 *
 * Idempotent for an already-archived survey: returns `{ok: true, outcome:
 * "archived"}` without any further write or response-count read, mirroring
 * `closeSurvey`'s "already in the target state, no-op" precedent.
 */
export async function deleteOrArchiveSurvey(
  idToken: string,
  teamId: string,
  surveyId: string,
  deps: DeleteOrArchiveSurveyDeps = {},
): Promise<DeleteOrArchiveSurveyResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    isSuperadmin: deps.isSuperadmin,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const surveyDocs = deps.surveyDocs ?? getDefaultSurveyDocStore(admin.identity.uid);

  let snapshot: DeleteOrArchiveSurveyDocSnapshot;
  try {
    snapshot = await surveyDocs.get(surveyId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const candidate = toCandidateSurvey(surveyId, snapshot.exists ? snapshot.data() : undefined);
  if (!isValidSurvey(candidate, { surveyId })) {
    return { ok: false, error: "survey_not_found" };
  }
  const survey: Survey = candidate;

  if (survey.teamId !== teamId) {
    return { ok: false, error: "wrong_team" };
  }

  const now = deps.now ?? new Date();
  if (effectiveLifecycle(survey, now) !== "closed") {
    return { ok: false, error: "not_closed" };
  }

  if (survey.archivedAt !== undefined) {
    return { ok: true, outcome: "archived" };
  }

  const responses = deps.responses ?? getDefaultResponsesExistenceReader();
  let hasResponses: boolean;
  try {
    hasResponses = await responses.hasAnyResponses(surveyId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  try {
    if (!hasResponses) {
      await surveyDocs.delete(surveyId);
      return { ok: true, outcome: "deleted" };
    }

    await surveyDocs.setArchivedAt(surveyId, now);
    return { ok: true, outcome: "archived" };
  } catch (error) {
    return { ok: false, error: writeRefusalFor(error) };
  }
}

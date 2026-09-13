import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  verifyIdToken,
  type VerifyIdTokenDeps,
} from "../../auth/server/verify-identity";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "../../teams/server/authorize-team-access";
import {
  effectiveLifecycle,
  isValidSurvey,
  type Survey,
} from "../../surveys/domain/survey";
import {
  computeSurveyAggregate,
  type CandidateResponseRecord,
  type DimensionMeans,
} from "../domain/aggregation";

const SURVEYS_COLLECTION = "surveys";
const SURVEY_RESPONSES_COLLECTION = "surveyResponses";
const TREND_WINDOW_SIZE = 12;

/**
 * One survey instance's entry in a team's results/history
 * (docs/features/managed-surveys/SPEC.md — "Results/history model"). Never
 * includes `createdBy`, encrypted payloads, or any `SurveyParticipation`
 * data (SPEC → "Response minimization, made explicit"). Below threshold,
 * `minimumResponses` is still present — the configured threshold is not
 * itself sensitive (SPEC → "Per-survey result threshold") — but `mean`/
 * `count` are absent entirely, never a suppressed placeholder value.
 */
export type SurveyResultEntry =
  | {
      surveyId: string;
      title?: string;
      date: Date;
      minimumResponses: number;
      status: "insufficient";
    }
  | {
      surveyId: string;
      title?: string;
      date: Date;
      minimumResponses: number;
      status: "published";
      mean: DimensionMeans;
      count: number;
    };

/** One raw `surveys` document, paired with its Firestore-assigned id (never itself part of the stored fields). */
export interface RawSurveyDoc {
  id: string;
  data: unknown;
}

/**
 * The expected shape of one raw `surveyResponses` document (TASK-006's
 * `SurveyResponseRecord`) — including its own persisted `teamId`, not just
 * `surveyId`. Not trusted until `isValidRawSurveyResponse` confirms it:
 * this operation must not assume a document returned by a `surveyId`-
 * scoped query actually belongs to the team it's being aggregated for
 * (post-review fix — "do not trust Firestore query scoping alone").
 */
export interface RawSurveyResponseDoc extends CandidateResponseRecord {
  surveyId: string;
  teamId: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Fail-closed runtime validator for one raw `surveyResponses` document —
 * the trust boundary a response must pass before it can count toward any
 * survey's `minimumResponses` or contribute to its aggregate (post-review
 * fix). Returns `false` (never throws) for a missing/non-object candidate,
 * a missing/blank `surveyId` or `teamId`, or a missing/wrong-typed
 * encrypted-payload field. A document that fails this check is excluded —
 * the same "malformed → excluded, never a hard read failure" policy
 * `decodeCandidate` (`results/domain/aggregation.ts`) already applies to
 * undecryptable ciphertext, applied one layer earlier to the document's
 * own shape, so there is exactly one corruption policy for this operation,
 * not two.
 */
function isValidRawSurveyResponse(data: unknown): data is RawSurveyResponseDoc {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const record = data as Record<string, unknown>;

  return (
    isNonEmptyString(record.surveyId) &&
    isNonEmptyString(record.teamId) &&
    typeof record.ciphertext === "string" &&
    typeof record.iv === "string" &&
    typeof record.authTag === "string" &&
    typeof record.keyVersion === "string"
  );
}

/**
 * The read/write seam this operation depends on, satisfied in production
 * by Firestore queries/a document update and by an in-memory fake in
 * tests. Kept as its own local seam per this codebase's established
 * one-seam-per-operation convention, mirroring `list-team-surveys.ts`/
 * `get-current-team-survey.ts`. `listResponsesForSurveyIds` returns raw,
 * unvalidated document data (mirroring `RawSurveyDoc.data: unknown`) —
 * `isValidRawSurveyResponse` is responsible for validating it before this
 * operation trusts it.
 */
export interface GetTeamSurveyResultsCollections {
  listRawSurveysForTeam(teamId: string): Promise<RawSurveyDoc[]>;
  listResponsesForSurveyIds(surveyIds: readonly string[]): Promise<unknown[]>;
  /**
   * Lazily persists `closedAt` for a survey that is `closed` purely because
   * its `endAt` has passed (docs/features/managed-surveys/SPEC.md —
   * "Sorting/display date"). Best-effort: a failure here never fails the
   * overall read — the in-memory `date` computed for this response is used
   * regardless of whether the write actually lands.
   */
  backfillClosedAt(surveyId: string, closedAt: Date): Promise<void>;
}

function getDefaultCollections(): GetTeamSurveyResultsCollections {
  return {
    async listRawSurveysForTeam(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(SURVEYS_COLLECTION)
        .where("teamId", "==", teamId)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    async listResponsesForSurveyIds(surveyIds) {
      if (surveyIds.length === 0) {
        return [];
      }
      const snapshot = await getFirestoreDb()
        .collection(SURVEY_RESPONSES_COLLECTION)
        .where("surveyId", "in", surveyIds as string[])
        .get();
      return snapshot.docs.map((doc) => doc.data());
    },
    async backfillClosedAt(surveyId, closedAt) {
      await getFirestoreDb().collection(SURVEYS_COLLECTION).doc(surveyId).update({ closedAt });
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

export type GetTeamSurveyResultsResult =
  | { ok: true; teamId: string; results: SurveyResultEntry[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

export interface GetTeamSurveyResultsDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  authCollection?: AuthorizeTeamAccessDeps["collection"];
  collections?: GetTeamSurveyResultsCollections;
}

/**
 * Resolves a signed-in caller's survey-instance results/history for one
 * team (docs/features/managed-surveys/SPEC.md — BR-25 through BR-28,
 * BR-42), replacing the calendar-period-scoped `getTeamResults`. The
 * results-viewing authorization boundary is reused completely unchanged
 * from the existing operation (`authorizeTeamAccess`, admin-or-member) —
 * this operation does not touch, narrow, or re-derive who may view
 * results, only how the underlying data is keyed and aggregated.
 *
 * Deliberately does **not** read or care about the owning team's
 * `active`/`disabled` status (BR-42): unlike survey *answerability*
 * (TASK-005/006), results/history visibility for an authorized
 * member/admin is unaffected by disabling the team.
 *
 * For each of the team's most recent 12 `closed` surveys (chronological,
 * oldest first — BR-28): if the survey was closed purely via a passed
 * `endAt` (never explicitly closed), its `closedAt` is lazily backfilled
 * (best-effort — a write failure never fails this read) and the backfilled
 * instant is used for sorting/display regardless. Each survey's own
 * `minimumResponses` (TASK-001's `isValidSurvey`, never a global/default
 * threshold) decides whether its aggregate publishes (BR-26) — a malformed
 * or missing `minimumResponses` fails closed by excluding that survey
 * entirely from the result (the same "malformed → excluded" convention
 * `list-team-surveys.ts`/`get-current-team-survey.ts` already use), never
 * assuming `DEFAULT_MINIMUM_RESPONSES`.
 *
 * A `scheduled`/`open` survey never appears (BR-27). Responses are
 * strictly `surveyId`-scoped (never aggregated by `teamId` alone), so a
 * response cannot cross survey boundaries into this result. **Post-review
 * fix**: a response's own persisted `teamId` is also cross-checked against
 * its named survey's `teamId` (`isValidRawSurveyResponse` +
 * `surveysById`), rather than trusting the `surveyId`-scoped Firestore
 * query alone — a mismatched or structurally malformed response is
 * excluded, never counted toward `minimumResponses` or included in the
 * aggregate.
 */
export async function getTeamSurveyResults(
  idToken: string,
  teamId: string,
  deps: GetTeamSurveyResultsDeps = {},
): Promise<GetTeamSurveyResultsResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "unauthenticated" };
  }

  const authResult = await authorizeTeamAccess(verified.identity, teamId, {
    allowList: deps.allowList,
    collection: deps.authCollection,
  });
  if (!authResult.ok) {
    return { ok: false, error: "read_failed" };
  }
  if (authResult.access === "denied") {
    return { ok: false, error: "forbidden" };
  }

  const collections = deps.collections ?? getDefaultCollections();
  const now = deps.now ?? new Date();

  let rawDocs: RawSurveyDoc[];
  try {
    rawDocs = await collections.listRawSurveysForTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const closed: Array<{ survey: Survey; date: Date }> = [];
  for (const { id, data } of rawDocs) {
    const candidate = toCandidateSurvey(id, data);
    if (!isValidSurvey(candidate, { surveyId: id })) {
      continue;
    }
    const survey: Survey = candidate;

    // Defense-in-depth cross-team check, mirroring `get-current-team-survey.ts`'s
    // post-review fix — the query already scopes by teamId, but a
    // structurally-valid, wrongly-scoped document is still excluded rather
    // than trusted.
    if (survey.teamId !== teamId) {
      continue;
    }

    if (effectiveLifecycle(survey, now) !== "closed") {
      continue;
    }

    let date = survey.closedAt;
    if (date === undefined) {
      // `effectiveLifecycle` only returns "closed" with `closedAt` unset
      // when `endAt` has passed — so `endAt` is guaranteed defined here.
      date = survey.endAt as Date;
      try {
        await collections.backfillClosedAt(survey.surveyId, date);
      } catch {
        // Best-effort — the next read that observes this survey tries
        // again; this read still proceeds using the correct `date`.
      }
    }

    closed.push({ survey, date });
  }

  // Chronological ascending (oldest first, BR-28), with a deterministic
  // tie-break by surveyId for identical timestamps.
  closed.sort((a, b) => {
    const diff = a.date.getTime() - b.date.getTime();
    if (diff !== 0) {
      return diff;
    }
    return a.survey.surveyId < b.survey.surveyId ? -1 : a.survey.surveyId > b.survey.surveyId ? 1 : 0;
  });

  const windowed = closed.slice(-TREND_WINDOW_SIZE);

  if (windowed.length === 0) {
    return { ok: true, teamId, results: [] };
  }

  const surveyIds = windowed.map(({ survey }) => survey.surveyId);
  let rawResponses: unknown[];
  try {
    rawResponses = await collections.listResponsesForSurveyIds(surveyIds);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  // `surveyId` → its own `Survey`, used to cross-check each response
  // against the exact survey it claims to belong to — never trusting the
  // `surveyId`-scoped Firestore query alone (post-review fix).
  const surveysById = new Map(windowed.map(({ survey }) => [survey.surveyId, survey]));

  const responsesBySurveyId = new Map<string, CandidateResponseRecord[]>();
  for (const raw of rawResponses) {
    // Structurally malformed (missing/wrong-typed `surveyId`, `teamId`, or
    // any encrypted-payload field) → excluded, the same fail-closed-by-
    // exclusion policy `decodeCandidate` already applies to undecryptable
    // ciphertext, applied one layer earlier to the document's own shape.
    if (!isValidRawSurveyResponse(raw)) {
      continue;
    }

    const owningSurvey = surveysById.get(raw.surveyId);
    // A response is eligible for a survey only if it actually names that
    // survey (never by `teamId` alone) *and* its own persisted `teamId`
    // agrees with that survey's `teamId`. A mismatch — corrupted or
    // inconsistent persisted data, unreachable via any current write path,
    // but never trusted regardless — is excluded exactly like a malformed
    // or undecryptable record: it never counts toward `minimumResponses`
    // and never contributes to the aggregate.
    if (owningSurvey === undefined || raw.teamId !== owningSurvey.teamId) {
      continue;
    }

    const existing = responsesBySurveyId.get(raw.surveyId) ?? [];
    existing.push({
      ciphertext: raw.ciphertext,
      iv: raw.iv,
      authTag: raw.authTag,
      keyVersion: raw.keyVersion,
    });
    responsesBySurveyId.set(raw.surveyId, existing);
  }

  const results: SurveyResultEntry[] = windowed.map(({ survey, date }) => {
    const aggregate = computeSurveyAggregate(
      survey.surveyId,
      responsesBySurveyId.get(survey.surveyId) ?? [],
      survey.minimumResponses,
    );

    if (aggregate.status === "published") {
      return {
        surveyId: survey.surveyId,
        ...(survey.title !== undefined ? { title: survey.title } : {}),
        date,
        minimumResponses: survey.minimumResponses,
        status: "published",
        mean: aggregate.mean,
        count: aggregate.count,
      };
    }

    return {
      surveyId: survey.surveyId,
      ...(survey.title !== undefined ? { title: survey.title } : {}),
      date,
      minimumResponses: survey.minimumResponses,
      status: "insufficient",
    };
  });

  return { ok: true, teamId, results };
}

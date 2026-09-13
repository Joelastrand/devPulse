import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { effectiveLifecycle, isValidSurvey, type Survey } from "../domain/survey";
import { readActiveSurveyId } from "../domain/team-survey-state";

const SURVEYS_COLLECTION = "surveys";
const TEAM_SURVEY_STATE_COLLECTION = "teamSurveyState";

function surveyPath(surveyId: string): string {
  return `${SURVEYS_COLLECTION}/${surveyId}`;
}

function teamSurveyStatePath(teamId: string): string {
  return `${TEAM_SURVEY_STATE_COLLECTION}/${teamId}`;
}

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface CloseSurveyDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The minimal transaction surface `closeSurvey`'s transactional decision
 * logic depends on — structurally identical to `OpenSurveyTransaction`
 * (`./open-survey.ts`), kept as its own local seam per this codebase's
 * established one-seam-per-operation convention (`create-survey.ts`'s
 * `SurveysCollection`, `open-survey.ts`'s `OpenSurveyDb`) rather than a new
 * shared abstraction module.
 */
export interface CloseSurveyTransaction {
  get(path: string): Promise<CloseSurveyDocSnapshot>;
  set(path: string, data: Record<string, unknown>): void;
  update(path: string, data: Record<string, unknown>): void;
}

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore `Firestore.runTransaction` call and by an in-memory fake in
 * tests.
 */
export interface CloseSurveyDb {
  runTransaction<T>(fn: (tx: CloseSurveyTransaction) => Promise<T>): Promise<T>;
}

function getDefaultDb(): CloseSurveyDb {
  const db = getFirestoreDb();
  return {
    runTransaction(fn) {
      return db.runTransaction((tx) => {
        const wrapped: CloseSurveyTransaction = {
          async get(path) {
            const snapshot = await tx.get(db.doc(path));
            return { exists: snapshot.exists, data: () => snapshot.data() };
          },
          set(path, data) {
            tx.set(db.doc(path), data);
          },
          update(path, data) {
            tx.update(db.doc(path), data);
          },
        };
        return fn(wrapped);
      });
    },
  };
}

export type CloseSurveyOutcome = "closed" | "already_closed" | "survey_not_found" | "not_open";

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

/**
 * The whole close decision, run inside one Firestore transaction
 * (docs/features/managed-surveys/SPEC.md — "One open survey per team" →
 * "Close"). Resolves and fail-closed-validates the target survey
 * (TASK-001's `isValidSurvey`) — `teamId` for the coordination lookup below
 * is always taken from this fetched, validated survey record, never a
 * caller-supplied value (`closeSurvey` takes no `teamId` parameter at all).
 *
 * A survey that was never opened (`scheduled`) has no manual "open → closed"
 * transition to perform — rejected (`not_open`), not silently treated as
 * idempotent (BR-7 only describes closing an *open* survey). An
 * already-closed survey — whether via an explicit `closedAt` or via `endAt`
 * having passed without one ever being written — is idempotent: no error,
 * and `closedAt` is left exactly as it was, never overwritten with `now`.
 * Backfilling `closedAt = endAt` for the latter case is deliberately not
 * done here: SPEC's "Sorting/display date" explicitly warns that using
 * `now` for that backfill "would be later and inaccurate," and the lazy
 * backfill it does describe is framed as a *read*-path concern (the first
 * operation that *reads* such a survey) for whichever later task
 * implements that read — out of this task's scope.
 *
 * For every non-`scheduled` outcome (newly closed or idempotently
 * already-closed), `teamSurveyState/{survey.teamId}` is read and
 * `activeSurveyId` is cleared to `null` only if it currently equals exactly
 * this `surveyId` — a defensive no-op for every other value (`null`, a
 * different survey's id, or a dangling/malformed pointer, per SPEC →
 * "Close": "a defensive no-op if it doesn't [match]"). This is a pure
 * string-equality check against a survey already fetched and validated as
 * belonging to `survey.teamId`, so — unlike `openSurvey`, which must
 * re-derive a *different* referenced survey's own lifecycle and team to
 * decide whether a conflict is real or stale — there is no ambiguous or
 * cross-team state to interpret here: a match can only ever legitimately
 * name this same, already-validated survey. No pointer value is ever
 * repaired, reinterpreted, or logged; it is only ever compared and, on an
 * exact match, cleared.
 *
 * **Read/write ordering** (fixed post-`Done`, discovered while
 * implementing TASK-006): every Firestore read this decision needs — the
 * survey, then, once it's known the outcome isn't `not_open`, the
 * coordination document — happens before either potential write (the
 * survey's `closedAt` update, the coordination pointer clear). A real
 * Firestore transaction throws if `.get()` is called after `.set()`/
 * `.update()` in the same attempt; the original implementation called
 * `tx.update` on the survey before the later `tx.get` on
 * `teamSurveyState`, which the in-memory test fake didn't reject but a
 * live Firestore backend would have. The decision logic and every
 * observable outcome are unchanged — only the read/write order was
 * corrected.
 */
async function decideAndApplyClose(
  tx: CloseSurveyTransaction,
  params: { surveyId: string; now: Date },
): Promise<CloseSurveyOutcome> {
  const { surveyId, now } = params;

  // READ PHASE — every read completes before any write is issued.
  const surveySnapshot = await tx.get(surveyPath(surveyId));
  const candidate = toCandidateSurvey(
    surveyId,
    surveySnapshot.exists ? surveySnapshot.data() : undefined,
  );
  if (!isValidSurvey(candidate, { surveyId })) {
    return "survey_not_found";
  }
  const survey: Survey = candidate;

  const lifecycle = effectiveLifecycle(survey, now);
  if (lifecycle === "scheduled") {
    return "not_open";
  }

  const stateSnapshot = await tx.get(teamSurveyStatePath(survey.teamId));
  const activeSurveyId = readActiveSurveyId(
    stateSnapshot.exists ? stateSnapshot.data() : undefined,
  );

  // DECISION PHASE — every read is in hand; decide what to write without
  // touching Firestore again.
  const shouldSetClosedAt = lifecycle === "open";
  const shouldClearPointer = activeSurveyId === surveyId;

  // WRITE PHASE — issued only after every read above has completed.
  if (shouldSetClosedAt) {
    tx.update(surveyPath(surveyId), { closedAt: now });
  }
  // else lifecycle === "closed" already (explicitly, or via `endAt`):
  // idempotent — `closedAt` is intentionally left untouched, see doc
  // comment above.

  if (shouldClearPointer) {
    tx.set(teamSurveyStatePath(survey.teamId), { activeSurveyId: null, updatedAt: now });
  }

  return shouldSetClosedAt ? "closed" : "already_closed";
}

export interface CloseSurveyResultOk {
  ok: true;
}

export interface CloseSurveyResultErr {
  ok: false;
  error: "unauthenticated" | "forbidden" | "survey_not_found" | "not_open" | "persistence_failed";
}

export type CloseSurveyResult = CloseSurveyResultOk | CloseSurveyResultErr;

export interface CloseSurveyDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  db?: CloseSurveyDb;
}

/**
 * Closes an `open` survey (docs/features/managed-surveys/SPEC.md — BR-7).
 * Only an app admin may call this successfully — reuses `requireAppAdmin`
 * unchanged. Unlike `openSurvey`/`createSurvey`, this takes no `teamId`
 * parameter: the survey's own persisted `teamId` (resolved only after the
 * survey has been fetched and validated inside the transaction) is the sole
 * source for the `teamSurveyState` coordination lookup — there is no
 * request-body or route-scoped `teamId` value for a caller to substitute.
 *
 * Closing is deliberately **not** gated on the owning team's `active`/
 * `disabled` status (unlike creating/opening a survey, SPEC → "Team disable
 * semantics" → "Creation/opening") — an admin must still be able to close
 * an already-open survey belonging to a team they've since disabled, for
 * administrative cleanup; BR-41/BR-42 only make a survey's *answerability*
 * conditional on team status, never the close action itself.
 *
 * Idempotent and terminal (BR-7): closing an already-closed survey (via an
 * explicit `closedAt` or via `endAt` having passed) succeeds without
 * modifying `closedAt`. Closing a survey that was never opened (`scheduled`)
 * is rejected (`not_open`) rather than treated as a no-op — there is no
 * "open → closed" transition to perform. No "reopen" operation exists or is
 * added by this function (SPEC Non-goals).
 */
export async function closeSurvey(
  idToken: string,
  surveyId: string,
  deps: CloseSurveyDeps = {},
): Promise<CloseSurveyResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const db = deps.db ?? getDefaultDb();
  const now = deps.now ?? new Date();

  let outcome: CloseSurveyOutcome;
  try {
    outcome = await db.runTransaction((tx) => decideAndApplyClose(tx, { surveyId, now }));
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (outcome === "closed" || outcome === "already_closed") {
    return { ok: true };
  }
  return { ok: false, error: outcome };
}

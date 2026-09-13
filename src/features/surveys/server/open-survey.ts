import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import type { VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import { isValidTeamStatus } from "../../teams/domain/team";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { effectiveLifecycle, isValidSurvey, type Survey } from "../domain/survey";
import { readActiveSurveyId } from "../domain/team-survey-state";

const SURVEYS_COLLECTION = "surveys";
const TEAMS_COLLECTION = "teams";
const TEAM_SURVEY_STATE_COLLECTION = "teamSurveyState";

function surveyPath(surveyId: string): string {
  return `${SURVEYS_COLLECTION}/${surveyId}`;
}

function teamPath(teamId: string): string {
  return `${TEAMS_COLLECTION}/${teamId}`;
}

function teamSurveyStatePath(teamId: string): string {
  return `${TEAM_SURVEY_STATE_COLLECTION}/${teamId}`;
}

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface OpenSurveyDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The minimal transaction surface `openSurvey`'s transactional decision
 * logic depends on — satisfied in production by a thin adapter over a real
 * Firestore `Transaction` (`firebase-admin/firestore`), and by an
 * in-memory fake in tests (including a fake that faithfully models
 * Firestore's own optimistic-concurrency-with-retry semantics, for a
 * genuine concurrency test — a hand-rolled fake that just tracks
 * "already written" would not actually prove the race-safety claim).
 * Document identity is a plain path string (`"surveys/{id}"`) rather than
 * a `DocumentReference`, so a fake can key its in-memory store by string
 * without depending on `firebase-admin` types at all.
 */
export interface OpenSurveyTransaction {
  get(path: string): Promise<OpenSurveyDocSnapshot>;
  set(path: string, data: Record<string, unknown>): void;
  update(path: string, data: Record<string, unknown>): void;
}

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore `Firestore.runTransaction` call and by an in-memory fake in
 * tests. Kept to exactly this one method so a test fake can implement
 * genuine optimistic-concurrency retry semantics without needing to
 * reimplement any part of the real Firebase Admin SDK.
 */
export interface OpenSurveyDb {
  runTransaction<T>(fn: (tx: OpenSurveyTransaction) => Promise<T>): Promise<T>;
}

function getDefaultDb(): OpenSurveyDb {
  const db = getFirestoreDb();
  return {
    runTransaction(fn) {
      return db.runTransaction((tx) => {
        const wrapped: OpenSurveyTransaction = {
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

export type OpenSurveyOutcome =
  | "opened"
  | "survey_not_found"
  | "wrong_team"
  | "not_scheduled"
  | "team_not_found"
  | "team_disabled"
  | "team_already_has_open_survey"
  | "invalid_coordination_state";

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
 * The whole race-safe "open" decision, run inside one Firestore
 * transaction (docs/features/managed-surveys/SPEC.md — "One open survey
 * per team"). All reads happen before any write, matching Firestore
 * transactions' own requirement and letting the caller retry the entire
 * decision — with fresh reads — on a detected write conflict.
 *
 * Order: resolve and fail-closed-validate the target survey (TASK-001's
 * `isValidSurvey`) → confirm it actually belongs to `teamId` (never trust
 * a caller-supplied `teamId`/`surveyId` pairing) → confirm its own derived
 * lifecycle is `scheduled` → re-check the owning team's `status` is
 * `active` fresh (BR-41) → read `teamSurveyState/{teamId}`'s
 * `activeSurveyId` fail-closed. Missing, non-string/blank, or dangling
 * (referencing no existing survey) is genuinely uninterpretable — treated
 * as "no conflict" and safely overwritten (self-heal). A structurally
 * valid referenced survey is then re-derived: if it belongs to a
 * *different* team, that's not uninterpretable — it's a positive sign
 * `teamSurveyState` itself is corrupted (this document is only ever
 * written by this function, always after confirming the exact same
 * match), so this fails closed instead of self-healing: no write of any
 * kind occurs. If it belongs to this team and re-derives as genuinely
 * `open`, that's a real conflict, rejected without any write. Otherwise
 * (this team's survey, but no longer open — explicitly closed or expired
 * via `endAt`) it's a stale conflict, self-corrected (overwritten).
 * Writes `openedAt` on the target survey and repoints `teamSurveyState`
 * at it, atomically, only on the success path.
 */
async function decideAndApplyOpen(
  tx: OpenSurveyTransaction,
  params: { teamId: string; surveyId: string; now: Date },
): Promise<OpenSurveyOutcome> {
  const { teamId, surveyId, now } = params;

  const surveySnapshot = await tx.get(surveyPath(surveyId));
  const candidate = toCandidateSurvey(
    surveyId,
    surveySnapshot.exists ? surveySnapshot.data() : undefined,
  );
  if (!isValidSurvey(candidate, { surveyId })) {
    return "survey_not_found";
  }
  const survey: Survey = candidate;

  if (survey.teamId !== teamId) {
    return "wrong_team";
  }

  if (effectiveLifecycle(survey, now) !== "scheduled") {
    return "not_scheduled";
  }

  const teamSnapshot = await tx.get(teamPath(teamId));
  const rawTeamStatus = teamSnapshot.exists
    ? (teamSnapshot.data() as Record<string, unknown> | undefined)?.status
    : undefined;
  if (!isValidTeamStatus(rawTeamStatus)) {
    return "team_not_found";
  }
  if (rawTeamStatus !== "active") {
    return "team_disabled";
  }

  const stateSnapshot = await tx.get(teamSurveyStatePath(teamId));
  const activeSurveyId = readActiveSurveyId(stateSnapshot.exists ? stateSnapshot.data() : undefined);

  if (activeSurveyId !== null) {
    const activeSnapshot = await tx.get(surveyPath(activeSurveyId));
    const activeCandidate = toCandidateSurvey(
      activeSurveyId,
      activeSnapshot.exists ? activeSnapshot.data() : undefined,
    );

    if (isValidSurvey(activeCandidate, { surveyId: activeSurveyId })) {
      // A structurally valid referenced survey that does not belong to
      // this team is not "no information" the way a dangling/malformed
      // pointer is (below) — it's a positive signal that
      // teamSurveyState/{teamId} is corrupted (this document is only ever
      // written by this same function, always after confirming this exact
      // match, so a mismatch here can only mean external/inconsistent
      // data). Silently self-healing it would erase evidence of that
      // corruption, so this fails closed instead: no write of any kind,
      // never opening the requested survey, never touching the pointer.
      if (activeCandidate.teamId !== teamId) {
        return "invalid_coordination_state";
      }

      if (effectiveLifecycle(activeCandidate, now) === "open") {
        return "team_already_has_open_survey";
      }
      // Same team, but the referenced survey is no longer genuinely open
      // (explicitly closed, or expired via `endAt` without ever being
      // explicitly closed) — a stale conflict, not a real one. Fall
      // through and self-heal it below.
    }
    // Otherwise the pointer is dangling (no such survey) or malformed —
    // genuinely uninterpretable, not a positive signal of anything. Fall
    // through and self-heal it below, exactly as before.
  }

  tx.update(surveyPath(surveyId), { openedAt: now });
  tx.set(teamSurveyStatePath(teamId), { activeSurveyId: surveyId, updatedAt: now });

  return "opened";
}

export interface OpenSurveyResultOk {
  ok: true;
}

export interface OpenSurveyResultErr {
  ok: false;
  error: "unauthenticated" | "forbidden" | Exclude<OpenSurveyOutcome, "opened"> | "persistence_failed";
}

export type OpenSurveyResult = OpenSurveyResultOk | OpenSurveyResultErr;

export interface OpenSurveyDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  db?: OpenSurveyDb;
}

/**
 * Opens a `scheduled` survey (docs/features/managed-surveys/SPEC.md —
 * BR-5, BR-6, BR-41's opening half). Only an app admin may call this
 * successfully — reuses `requireAppAdmin` unchanged. `teamId` is always
 * the caller's own trusted server/route scope (mirrors `createSurvey`),
 * never inferred from the survey record until *after* it's been fetched
 * and validated — a `surveyId` that resolves to a different team's survey
 * is rejected (`wrong_team`), never silently opened under the wrong scope.
 *
 * The entire decision — survey validity, team match, target lifecycle,
 * owning-team active status, and the one-open-survey-per-team check via
 * `teamSurveyState/{teamId}` — happens inside one Firestore transaction,
 * so two concurrent `openSurvey` calls for the same team can never both
 * succeed (BR-6): Firestore serializes conflicting transactions against
 * the documents they both read, committing exactly one and retrying the
 * other with fresh reads.
 */
export async function openSurvey(
  idToken: string,
  teamId: string,
  surveyId: string,
  deps: OpenSurveyDeps = {},
): Promise<OpenSurveyResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  const db = deps.db ?? getDefaultDb();
  const now = deps.now ?? new Date();

  let outcome: OpenSurveyOutcome;
  try {
    outcome = await db.runTransaction((tx) => decideAndApplyOpen(tx, { teamId, surveyId, now }));
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (outcome === "opened") {
    return { ok: true };
  }
  return { ok: false, error: outcome };
}

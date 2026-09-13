import "server-only";
import { encrypt } from "../../../lib/encryption/encryption";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import {
  verifyIdToken,
  type VerifiedIdentity,
  type VerifyIdTokenDeps,
} from "../../auth/server/verify-identity";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import { validateSurveyAnswers, type SurveyAnswers } from "../domain/answers";
import { participationDocId, type SurveyParticipationRecord } from "../domain/survey-participation";
import { effectiveLifecycle, isValidSurvey, type Survey } from "../domain/survey";

const SURVEYS_COLLECTION = "surveys";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";
const SURVEY_RESPONSES_COLLECTION = "surveyResponses";
const SURVEY_PARTICIPATIONS_COLLECTION = "surveyParticipations";

function surveyPath(surveyId: string): string {
  return `${SURVEYS_COLLECTION}/${surveyId}`;
}

function teamPath(teamId: string): string {
  return `${TEAMS_COLLECTION}/${teamId}`;
}

function membershipPath(uid: string, teamId: string): string {
  return `${MEMBERSHIPS_COLLECTION}/${membershipDocId(uid, teamId)}`;
}

function participationPath(uid: string, surveyId: string): string {
  return `${SURVEY_PARTICIPATIONS_COLLECTION}/${participationDocId(uid, surveyId)}`;
}

function responsePath(responseId: string): string {
  return `${SURVEY_RESPONSES_COLLECTION}/${responseId}`;
}

/** The persisted shape of one `surveyResponses` document (docs/features/managed-surveys/SPEC.md — "Firestore/index implications"). No identity field, no IP, no user agent, for either access mode. */
export interface SurveyResponseRecord {
  surveyId: string;
  teamId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
  submittedAt: Date;
}

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface SubmitSurveyResponseDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The minimal transaction surface `submitSurveyResponse`'s transactional
 * decision logic depends on — structurally the same shape as
 * `OpenSurveyTransaction`/`CloseSurveyTransaction` (kept as its own local
 * seam per this codebase's established one-seam-per-operation convention),
 * with `set` used for both the `surveyResponses` and (for `authenticated`
 * mode) `surveyParticipations` writes — no `update`, since neither document
 * is ever partially modified after creation.
 */
export interface SubmitSurveyResponseTransaction {
  get(path: string): Promise<SubmitSurveyResponseDocSnapshot>;
  set(path: string, data: Record<string, unknown>): void;
}

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore `Firestore.runTransaction` call and by an in-memory fake in
 * tests. `newResponseId` mints an opaque, random Firestore document id
 * (never derived from `uid`/`surveyId`) without itself performing any
 * read/write — safe to call at any point in a transaction attempt.
 */
export interface SubmitSurveyResponseDb {
  runTransaction<T>(fn: (tx: SubmitSurveyResponseTransaction) => Promise<T>): Promise<T>;
  newResponseId(): string;
}

function getDefaultDb(): SubmitSurveyResponseDb {
  const db = getFirestoreDb();
  return {
    runTransaction(fn) {
      return db.runTransaction((tx) => {
        const wrapped: SubmitSurveyResponseTransaction = {
          async get(path) {
            const snapshot = await tx.get(db.doc(path));
            return { exists: snapshot.exists, data: () => snapshot.data() };
          },
          set(path, data) {
            tx.set(db.doc(path), data);
          },
        };
        return fn(wrapped);
      });
    },
    newResponseId() {
      return db.collection(SURVEY_RESPONSES_COLLECTION).doc().id;
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

export type SubmitOutcome =
  | "submitted"
  | "invalid_submission"
  | "survey_unavailable"
  | "unauthenticated"
  | "forbidden"
  | "already_submitted"
  | "encryption_failed";

/**
 * The whole submission decision, run inside one Firestore transaction
 * (docs/features/managed-surveys/SPEC.md — "Survey submission contract" →
 * Phase B). Every read happens before any write (Firestore's own
 * transaction requirement, and what lets a detected write conflict retry
 * the entire decision with fresh reads): survey → lifecycle → owning
 * team's status → (for `authenticated` only) membership → participation.
 * Only once every check has passed does this encrypt the answers and write.
 *
 * `identity` is the already-verified caller identity from Phase A (or
 * `null` for no/invalid token) — re-checked here only for *authorization*
 * (actual membership, not merely a valid token), never re-verified as a
 * token. `teamId`/`accessMode` are read exclusively from this fresh survey
 * document, never from a caller-supplied value (BR-19) — this function
 * accepts no such parameter at all.
 *
 * A nonexistent or malformed survey resolves to `invalid_submission` — the
 * exact same generic rejection as a structurally invalid answer payload
 * (SPEC step 3: "no distinguishing detail," mirroring Phase 1's
 * `submitPulseSurvey` posture). A lifecycle that isn't `open`, or an owning
 * team that isn't validly `active`, both resolve to `survey_unavailable` —
 * deliberately one bucket, not two, so a disabled/missing/malformed team
 * is never a distinguishable signal from an ordinary closed survey (BR-41,
 * mirroring `resolveSurveyForParticipation`'s identical fold).
 */
async function decideAndApplySubmission(
  tx: SubmitSurveyResponseTransaction,
  params: {
    surveyId: string;
    answers: SurveyAnswers;
    identity: VerifiedIdentity | null;
    now: Date;
    newResponseId: () => string;
  },
): Promise<SubmitOutcome> {
  const { surveyId, answers, identity, now, newResponseId } = params;

  const surveySnapshot = await tx.get(surveyPath(surveyId));
  const candidate = toCandidateSurvey(
    surveyId,
    surveySnapshot.exists ? surveySnapshot.data() : undefined,
  );
  if (!isValidSurvey(candidate, { surveyId })) {
    return "invalid_submission";
  }
  const survey: Survey = candidate;

  if (effectiveLifecycle(survey, now) !== "open") {
    return "survey_unavailable";
  }

  const teamSnapshot = await tx.get(teamPath(survey.teamId));
  const rawTeamStatus = teamSnapshot.exists
    ? (teamSnapshot.data() as Record<string, unknown> | undefined)?.status
    : undefined;
  if (!isValidTeamStatus(rawTeamStatus) || rawTeamStatus !== "active") {
    return "survey_unavailable";
  }

  if (survey.accessMode === "authenticated") {
    if (identity === null) {
      return "unauthenticated";
    }

    const membershipSnapshot = await tx.get(membershipPath(identity.uid, survey.teamId));
    const isMember = isValidMembershipFor(
      membershipSnapshot.exists ? membershipSnapshot.data() : undefined,
      { uid: identity.uid, teamId: survey.teamId },
    );
    if (!isMember) {
      return "forbidden";
    }

    const participationSnapshot = await tx.get(participationPath(identity.uid, surveyId));
    if (participationSnapshot.exists) {
      return "already_submitted";
    }
  }

  // Every read is complete at this point — everything below is a write, so
  // this ordering is what a real Firestore transaction requires and what
  // makes a detected conflict retry cleanly with fresh reads above.
  let encrypted;
  try {
    encrypted = encrypt(JSON.stringify(answers));
  } catch {
    return "encryption_failed";
  }

  const responseRecord: SurveyResponseRecord = {
    surveyId,
    teamId: survey.teamId,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    submittedAt: now,
  };
  tx.set(responsePath(newResponseId()), responseRecord as unknown as Record<string, unknown>);

  if (survey.accessMode === "authenticated" && identity !== null) {
    const participationRecord: SurveyParticipationRecord = {
      uid: identity.uid,
      surveyId,
    };
    tx.set(
      participationPath(identity.uid, surveyId),
      participationRecord as unknown as Record<string, unknown>,
    );
  }

  return "submitted";
}

export type SubmitSurveyResponseResult =
  | { ok: true }
  | {
      ok: false;
      error: Exclude<SubmitOutcome, "submitted"> | "persistence_failed";
    };

/**
 * A minimal callable clock — `() => Date` — rather than a single frozen
 * `Date`. `submitSurveyResponse` calls this fresh on every Firestore
 * transaction *attempt* (including retries), not once per call, so a
 * retry's `effectiveLifecycle` check always uses the server's actual time
 * at that attempt, never a stale instant captured before an earlier
 * attempt's conflict. Deliberately just a callable, not a general clock
 * abstraction — the default (`() => new Date()`) is real wall-clock time;
 * a test supplies a fixed or attempt-sequenced function instead.
 */
export type SubmitSurveyResponseClock = () => Date;

export interface SubmitSurveyResponseDeps {
  now?: SubmitSurveyResponseClock;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  db?: SubmitSurveyResponseDb;
}

/**
 * Submits one respondent's answers to `surveyId` (docs/features/
 * managed-surveys/SPEC.md — BR-17 through BR-24, BR-41's submission half).
 *
 * Phase A (outside any transaction, no persistence side effect): validates
 * the three answers (TASK-001's `validateSurveyAnswers`, reused unchanged —
 * invalid → `invalid_submission`, nothing persisted); if `idToken` is
 * supplied, verifies it for *identity only* (an invalid/revoked token
 * yields `identity: null`, exactly as if no token had been supplied at
 * all — authorization itself is decided in Phase B, not here).
 *
 * Phase B (one Firestore transaction, `decideAndApplySubmission`):
 * re-reads the survey, its derived lifecycle, its owning team's status,
 * and — for `authenticated` mode — actual membership and any existing
 * `SurveyParticipation`, all fresh at commit time, never from an earlier
 * read. This is what makes the submit-vs-close race, the `endAt`-crossing
 * race, the team-disabled-mid-flight race, the membership-revocation race,
 * and the duplicate-submission race all safe by construction: Firestore
 * serializes conflicting transactions against the documents they both
 * read/write, so a concurrent state change lands either entirely before or
 * entirely after this transaction's own read, never torn.
 *
 * `SurveyResponse` never contains `uid`/`email`/any identity field, for
 * either access mode (BR-17). For `authenticated` mode only, a
 * `SurveyParticipation` (`{uid, surveyId}`, deliberately no `submittedAt`)
 * is written in the *same* transaction as the response — both commit
 * together or neither does, so there is no partial-success state to
 * compensate for. This design provides strict exactly-once acceptance per
 * (uid, surveyId) pair for `authenticated` submissions specifically — it
 * does not claim exactly-once delivery to the client: a client that never
 * observes its own successful commit (a lost-in-transit response, a
 * timeout) and retries will find its own already-created
 * `SurveyParticipation` and be rejected as a duplicate, which is the
 * correct, safe outcome (no second response is ever created), not a false
 * "exactly-once success is guaranteed to the caller" claim. `public` mode
 * has no such guarantee at all (BR-23) — repeated submissions from the same
 * visitor all succeed independently, by design.
 *
 * **`now` is re-acquired on every transaction attempt, not once per call**
 * (fixed post-`Done`, discovered in review): `deps.now`/the real-clock
 * default is a *callable* (`SubmitSurveyResponseClock`), invoked fresh each
 * time `db.runTransaction`'s callback runs — including every Firestore
 * retry. Unlike the survey/team/membership/participation documents (which
 * a retry re-reads fresh by construction), `endAt`'s crossing is never
 * itself a Firestore write — it's purely a comparison against the caller's
 * own `now` — so a `now` captured once before the first attempt would let
 * a later retry (triggered by some unrelated conflicting write) still
 * evaluate `effectiveLifecycle` as if no time had passed, even though the
 * survey's real `endAt` boundary may have been crossed in the meantime.
 * Calling the clock is not itself a Firestore operation, so this doesn't
 * affect the read-before-write ordering within any single attempt.
 */
export async function submitSurveyResponse(
  surveyId: string,
  rawAnswers: unknown,
  idToken: string | undefined,
  deps: SubmitSurveyResponseDeps = {},
): Promise<SubmitSurveyResponseResult> {
  const validated = validateSurveyAnswers(rawAnswers);
  if (!validated.ok) {
    return { ok: false, error: "invalid_submission" };
  }

  let identity: VerifiedIdentity | null = null;
  if (idToken) {
    const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
    if (verified.ok) {
      identity = verified.identity;
    }
    // An invalid/revoked token is not itself a fatal `submitSurveyResponse`
    // error — it simply yields no identity, exactly like an absent token.
    // A `public` survey never needed one; an `authenticated` survey rejects
    // a missing identity as `unauthenticated` inside Phase B, below.
  }

  const db = deps.db ?? getDefaultDb();
  const getNow: SubmitSurveyResponseClock = deps.now ?? (() => new Date());

  let outcome: SubmitOutcome;
  try {
    outcome = await db.runTransaction((tx) =>
      decideAndApplySubmission(tx, {
        surveyId,
        answers: validated.data,
        identity,
        // Called fresh on every invocation of this callback — i.e. once
        // per Firestore transaction attempt, including retries — never
        // hoisted out and reused across attempts.
        now: getNow(),
        newResponseId: () => db.newResponseId(),
      }),
    );
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (outcome === "submitted") {
    return { ok: true };
  }
  return { ok: false, error: outcome };
}

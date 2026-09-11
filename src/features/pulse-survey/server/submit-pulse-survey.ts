import { encrypt } from "../../../lib/encryption/encryption";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { listActiveTeams } from "../../teams/server/list-active-teams";
import { getCurrentSurveyPeriod } from "../domain/period";
import { validateSubmission } from "../domain/validation";

const COLLECTION_NAME = "pulseSurveyResponses";

/** The minimal, non-identity persisted shape for one pulse survey response. */
export interface PersistedPulseSurveyRecord {
  teamId: string;
  period: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}

/**
 * The team-validation seam this operation depends on, satisfied in
 * production by the teams feature's `listActiveTeams` (the same
 * authoritative source the survey selector itself reads — BR-31/BR-32)
 * and by an in-memory fake in tests. Re-read fresh on every submission, so
 * a team disabled after the selector was rendered is rejected here even
 * though it looked active at page-load time (TOCTOU).
 */
export interface ActiveTeamsSource {
  listActive: typeof listActiveTeams;
}

function getDefaultActiveTeamsSource(): ActiveTeamsSource {
  return { listActive: listActiveTeams };
}

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore `CollectionReference` and by an in-memory fake in tests — so
 * tests never need a real Firestore project/credentials.
 */
export interface PulseSurveyCollection {
  add(record: PersistedPulseSurveyRecord): Promise<{ id: string }>;
}

export type SubmitPulseSurveyResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "invalid_submission"
        | "team_validation_failed"
        | "encryption_failed"
        | "persistence_failed";
    };

export interface SubmitPulseSurveyDeps {
  now?: Date;
  collection?: PulseSurveyCollection;
  activeTeams?: ActiveTeamsSource;
}

function getDefaultCollection(): PulseSurveyCollection {
  return getFirestoreDb().collection(COLLECTION_NAME);
}

/**
 * Validates, encrypts, and persists one pulse survey submission.
 *
 * Order is significant (docs/features/team-management/SPEC.md — TASK-006):
 * structural input validation, then active-team validation (re-read from
 * Firestore on every submission — the selector's own page-load snapshot is
 * never trusted, closing the "active at load, disabled before submit" race),
 * then the server-computed period, then encryption, then persistence. A
 * disabled, nonexistent, or malformed `teamId` is rejected with the exact
 * same `invalid_submission` result as any other invalid submission — no
 * distinguishing signal is given to the anonymous respondent. A Firestore
 * failure while checking team validity fails closed as
 * `team_validation_failed`, distinct from `invalid_submission`, so an
 * infrastructure failure is never conflated with (or silently treated as)
 * a valid rejection, and no response is ever written on either path.
 *
 * Nothing is logged here, including on the team-validation-, encryption-,
 * or persistence-failure paths — SECURITY.md invariant 14 forbids survey
 * content in logs, and error objects (which may carry the ENCRYPTION_KEY
 * failure reason or a Firestore error) could otherwise be logged
 * incidentally. `encrypt` fails closed by throwing when ENCRYPTION_KEY is
 * missing or invalid; that must not propagate as an unhandled rejection,
 * so it is caught here and reported the same generic way as any other
 * failure, before any Firestore write is attempted.
 */
export async function submitPulseSurvey(
  rawInput: unknown,
  deps: SubmitPulseSurveyDeps = {},
): Promise<SubmitPulseSurveyResult> {
  const validation = validateSubmission(rawInput);
  if (!validation.ok) {
    return { ok: false, error: "invalid_submission" };
  }

  const activeTeams = deps.activeTeams ?? getDefaultActiveTeamsSource();

  let activeTeamsResult;
  try {
    activeTeamsResult = await activeTeams.listActive();
  } catch {
    return { ok: false, error: "team_validation_failed" };
  }

  if (!activeTeamsResult.ok) {
    return { ok: false, error: "team_validation_failed" };
  }

  const isActiveTeam = activeTeamsResult.teams.some(
    (team) => team.teamId === validation.data.teamId,
  );
  if (!isActiveTeam) {
    return { ok: false, error: "invalid_submission" };
  }

  const period = getCurrentSurveyPeriod(deps.now);

  let encrypted;
  try {
    encrypted = encrypt(JSON.stringify(validation.data.answers));
  } catch {
    return { ok: false, error: "encryption_failed" };
  }

  const record: PersistedPulseSurveyRecord = {
    teamId: validation.data.teamId,
    period,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
  };

  const collection = deps.collection ?? getDefaultCollection();

  try {
    await collection.add(record);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  return { ok: true };
}

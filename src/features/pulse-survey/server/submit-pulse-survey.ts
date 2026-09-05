import { encrypt } from "../../../lib/encryption/encryption";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { getCurrentSurveyPeriod } from "../domain/period";
import { validateSubmission } from "../domain/validation";
import type { TeamId } from "../domain/teams";

const COLLECTION_NAME = "pulseSurveyResponses";

/** The minimal, non-identity persisted shape for one pulse survey response. */
export interface PersistedPulseSurveyRecord {
  teamId: TeamId;
  period: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
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
      error: "invalid_submission" | "encryption_failed" | "persistence_failed";
    };

export interface SubmitPulseSurveyDeps {
  now?: Date;
  collection?: PulseSurveyCollection;
}

function getDefaultCollection(): PulseSurveyCollection {
  return getFirestoreDb().collection(COLLECTION_NAME);
}

/**
 * Validates, encrypts, and persists one pulse survey submission.
 *
 * Nothing is logged here, including on the encryption- or
 * persistence-failure paths — SECURITY.md invariant 14 forbids survey
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

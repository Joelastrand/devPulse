import "server-only";
import { encrypt } from "../../../lib/encryption/encryption";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import type { ChallengeKeyVersion } from "../domain/challenge";
import { validateChallengeText } from "../domain/challenge-text";

const CHALLENGES_COLLECTION = "challenges";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * The persisted shape of one `challenges` document at creation time
 * (docs/features/anonymous-challenges/SPEC.md — "Data model"). No
 * `challengeId` field (mirrors `SurveyRecord`'s own-id-excluded convention —
 * the id is Firestore's auto-generated document id). No `resolvedAt`/
 * `resolvedBy`/`archivedAt`/`archivedBy` — those are only ever set later,
 * by TASK-004's management operations, never at submission. No submitter
 * identity field of any kind, for any submitter — this is the privacy
 * guarantee this feature exists to implement (BR-4).
 */
export interface ChallengeRecord {
  teamId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: ChallengeKeyVersion;
  submittedAt: Date;
}

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore `CollectionReference` (whose `.add()` assigns the opaque,
 * auto-generated document id) and by an in-memory fake in tests.
 */
export interface ChallengesCollection {
  add(record: ChallengeRecord): Promise<{ id: string }>;
}

function getDefaultChallengesCollection(): ChallengesCollection {
  return getFirestoreDb().collection(CHALLENGES_COLLECTION);
}

/**
 * The read seam for a real `teamMemberships/{uid}__{teamId}` record,
 * satisfied in production by a Firestore document read and by an in-memory
 * fake in tests. Returns raw, unvalidated data — `submitChallenge` is
 * responsible for validating it (via `isValidMembershipFor`) before
 * trusting it, exactly as `resolveSurveyForParticipation`/
 * `submitSurveyResponse` already do for the same field.
 */
export interface MembershipReader {
  getMembership(uid: string, teamId: string): Promise<unknown>;
}

function getDefaultMembershipReader(): MembershipReader {
  return {
    async getMembership(uid, teamId) {
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .doc(membershipDocId(uid, teamId))
        .get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
  };
}

/**
 * The read seam for the owning team's fresh `status`, satisfied in
 * production by a Firestore document read and by an in-memory fake in
 * tests. Mirrors `createSurvey`'s `TeamStatusReader` exactly.
 */
export interface TeamStatusReader {
  getTeamStatus(teamId: string): Promise<unknown>;
}

function getDefaultTeamStatusReader(): TeamStatusReader {
  return {
    async getTeamStatus(teamId) {
      const snapshot = await getFirestoreDb().collection(TEAMS_COLLECTION).doc(teamId).get();
      return snapshot.exists ? snapshot.data()?.status : undefined;
    },
  };
}

export type SubmitChallengeResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "sign_in_required"
        | "invalid_input"
        | "forbidden"
        | "team_not_found"
        | "team_disabled"
        | "encryption_failed"
        | "persistence_failed";
    };

export interface SubmitChallengeDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  membershipReader?: MembershipReader;
  teamStatusReader?: TeamStatusReader;
  collection?: ChallengesCollection;
}

/**
 * Submits one anonymous challenge for `teamId` (docs/features/
 * anonymous-challenges/SPEC.md — BR-1, BR-2, BR-4, BR-5, BR-7, BR-8, BR-33).
 * `teamId` is always the caller's trusted server/route scope — this
 * function accepts no `teamId`-shaped request field, so there is nothing in
 * `rawText` for a caller to override it with.
 *
 * Order of checks, in this exact sequence (SPEC — "Server operations"):
 * verify the ID token (`sign_in_required` if absent/invalid) → validate
 * `rawText` (`validateChallengeText`, TASK-001, reused unchanged —
 * `invalid_input`, nothing read or written yet) → confirm a real
 * `teamMemberships/{uid}__{teamId}` record exists (BR-1) via
 * `isValidMembershipFor` — deliberately **not** `authorizeTeamAccess`,
 * whose `"admin"` result would incorrectly grant an app admin with no real
 * membership eligibility to submit (mirrors `resolveSurveyForParticipation`/
 * `submitSurveyResponse`'s identical BR-16-style handling) → re-read
 * `teams/{teamId}.status` fresh (`team_not_found`/`team_disabled` if not
 * `active`, BR-7) → encrypt the validated text server-side with a fresh IV
 * → persist one `challenges/{auto-id}` document.
 *
 * No Firestore transaction is used — a single-document write with no
 * cross-document invariant to protect (unlike `submitSurveyResponse`'s
 * paired response/participation write), so a plain fresh team-status read
 * immediately before the single `.add()` is sufficient (mirrors
 * `createSurvey`'s simpler plain-read pattern).
 *
 * Returns only success/failure — never a generated `challengeId`, never the
 * submitted text (mirrors `submitSurveyResponse`'s response-minimization
 * posture) — so a successful response carries no correlation handle.
 *
 * Fails closed on every infrastructure failure: a Firestore read error maps
 * to `persistence_failed`; an `encrypt` failure (e.g. missing
 * `ENCRYPTION_KEY`) maps to `encryption_failed`, mirroring
 * `submitSurveyResponse`'s own outcome naming — neither path ever falls
 * back to plaintext, and neither is ever logged with any detail from the
 * thrown error.
 */
export async function submitChallenge(
  idToken: string,
  teamId: string,
  rawText: unknown,
  deps: SubmitChallengeDeps = {},
): Promise<SubmitChallengeResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "sign_in_required" };
  }

  const validated = validateChallengeText(rawText);
  if (!validated.ok) {
    return { ok: false, error: "invalid_input" };
  }

  const membershipReader = deps.membershipReader ?? getDefaultMembershipReader();
  let rawMembership: unknown;
  try {
    rawMembership = await membershipReader.getMembership(verified.identity.uid, teamId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const isMember = isValidMembershipFor(rawMembership, { uid: verified.identity.uid, teamId });
  if (!isMember) {
    return { ok: false, error: "forbidden" };
  }

  const teamStatusReader = deps.teamStatusReader ?? getDefaultTeamStatusReader();
  let rawTeamStatus: unknown;
  try {
    rawTeamStatus = await teamStatusReader.getTeamStatus(teamId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  if (!isValidTeamStatus(rawTeamStatus)) {
    // Covers both "no such team" (Firestore returns `undefined`) and a
    // malformed/unrecognized status — fail closed exactly like
    // `createSurvey` does for the same field, never assuming "active" for
    // an un-interpretable read.
    return { ok: false, error: "team_not_found" };
  }
  if (rawTeamStatus !== "active") {
    return { ok: false, error: "team_disabled" };
  }

  let encrypted;
  try {
    encrypted = encrypt(validated.text);
  } catch {
    return { ok: false, error: "encryption_failed" };
  }

  const record: ChallengeRecord = {
    teamId,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    submittedAt: deps.now ?? new Date(),
  };

  const collection = deps.collection ?? getDefaultChallengesCollection();
  try {
    await collection.add(record);
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

import "server-only";
import type { EncryptedPayload } from "../../../lib/encryption/encryption";
import { decrypt } from "../../../lib/encryption/encryption";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import type { IsAppAdminDeps } from "../../teams/domain/app-admin";
import {
  authorizeTeamAccess,
  type AuthorizeTeamAccessDeps,
} from "../../teams/server/authorize-team-access";
import { requireAppAdmin } from "../../teams/server/require-app-admin";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import {
  effectiveChallengeStatus,
  isValidChallenge,
  type Challenge,
  type ChallengeStatus,
} from "../domain/challenge";

const CHALLENGES_COLLECTION = "challenges";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * The statuses each public read operation may ever return — fixed here,
 * never derived from a request/client-supplied value of any kind (BR-36).
 * `fetchTeamChallenges` only ever receives one of these two constants from
 * its two callers below.
 */
const MEMBER_ALLOWED_STATUSES: readonly ChallengeStatus[] = ["open", "resolved"];
const ADMIN_ALLOWED_STATUSES: readonly ChallengeStatus[] = ["open", "resolved", "archived"];

/**
 * The minimal, response-minimized DTO returned by either read operation
 * (docs/features/anonymous-challenges/SPEC.md — BR-11, BR-12, BR-13).
 * Deliberately excludes `resolvedAt`/`resolvedBy`/`archivedAt`/`archivedBy`
 * and every encrypted field (`iv`/`authTag`/`keyVersion`) — a viewer sees
 * only that a challenge is `resolved`/`archived`, never when or by whom.
 * `submittedAt` is the submission **date only** (BR-12) — the exact
 * time-of-day is never computed into this shape at all.
 */
export interface TeamChallengeView {
  challengeId: string;
  text: string;
  status: ChallengeStatus;
  submittedAt: string;
}

/** One raw `challenges` document, paired with its Firestore-assigned id (never itself part of the stored fields). */
export interface RawChallengeDoc {
  id: string;
  data: unknown;
}

/**
 * The read seam this operation depends on, satisfied in production by a
 * Firestore query and by an in-memory fake in tests. Returns every raw
 * `challenges` document for the team regardless of validity or lifecycle
 * state — filtering/validation happens entirely in `fetchTeamChallenges`,
 * never here (mirrors `list-team-surveys.ts`'s `TeamSurveysCollection`
 * seam).
 */
export interface ChallengesReader {
  listRawForTeam(teamId: string): Promise<RawChallengeDoc[]>;
}

function getDefaultChallengesReader(): ChallengesReader {
  return {
    async listRawForTeam(teamId) {
      const snapshot = await getFirestoreDb()
        .collection(CHALLENGES_COLLECTION)
        .where("teamId", "==", teamId)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}

/** Maps raw Firestore document data (Timestamp fields included) into the candidate shape `isValidChallenge` expects. */
function toCandidateChallenge(challengeId: string, data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  return {
    ...record,
    challengeId,
    submittedAt: toDateOrUndefined(record.submittedAt),
    resolvedAt: toDateOrUndefined(record.resolvedAt),
    archivedAt: toDateOrUndefined(record.archivedAt),
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
  // Left as-is (not a Date) so `isValidChallenge`'s `isValidDate` check
  // fails closed on it, rather than silently coercing an unexpected shape.
  return value;
}

/** Formats a `Date` as its UTC calendar date only (`YYYY-MM-DD`) — never the time-of-day component (BR-12). */
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type ListTeamChallengesResult =
  | { ok: true; challenges: TeamChallengeView[] }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

/**
 * The read seam for a real `teamMemberships/{uid}__{teamId}` record, mirroring
 * `submit-challenge.ts`'s identical seam (kept as its own local declaration,
 * not a cross-module import, matching this codebase's existing per-operation
 * dependency-seam convention — e.g. `TeamStatusReader` is similarly declared
 * independently in both `submit-challenge.ts` and `create-survey.ts`). Used
 * here only to compute `canSubmit` below; never influences which challenges
 * are returned.
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
 * Independently re-derives "is this caller a genuine current team member,"
 * using the exact same real-membership semantics `submitChallenge` requires
 * (docs/features/anonymous-challenges/SPEC.md — BR-1) — never inferred from
 * `authorizeTeamAccess`'s broader `"admin"`/`"member"` result, since an app
 * admin short-circuits that check before membership is ever read
 * (`authorize-team-access.ts`) — BR-1's "app-admin status alone is never
 * sufficient" applies identically to *submission eligibility*, which this
 * value exists to expose to the UI (debug investigation, Challenge
 * submission composition gap). Fails closed (`false`) on any read error or
 * malformed record — a transient failure to confirm membership must never
 * present a submission affordance the server would then reject anyway.
 */
async function resolveCanSubmit(
  uid: string,
  teamId: string,
  reader: MembershipReader,
): Promise<boolean> {
  try {
    const rawMembership = await reader.getMembership(uid, teamId);
    return isValidMembershipFor(rawMembership, { uid, teamId });
  } catch {
    return false;
  }
}

/**
 * `listTeamChallengesForMember`'s own result shape — the same success shape
 * as `ListTeamChallengesResult` plus `canSubmit`, a boolean-only capability
 * signal for whether *this* caller may submit a new challenge for this team
 * (never a uid, membership document, or any other identity-shaped value).
 * `listTeamChallengesForAdmin` is unaffected and keeps returning the plain
 * `ListTeamChallengesResult` above — the admin management page never renders
 * a submission form, so it has no use for this field.
 */
export type ListTeamChallengesForMemberResult =
  | { ok: true; challenges: TeamChallengeView[]; canSubmit: boolean }
  | { ok: false; error: "unauthenticated" | "forbidden" | "read_failed" };

/**
 * The private, unexported core both public operations below share, so
 * decryption/validation logic is not duplicated (SPEC — "Server
 * operations"). `allowedStatuses` is always a fixed constant supplied by
 * the caller below — this function has no path by which a request/client
 * value could reach it.
 *
 * Processing order, exactly as SPEC's "Shared helper" section specifies —
 * the order itself is the privacy guarantee (BR-37):
 * query by `teamId` → validate (`isValidChallenge`, fail-closed) →
 * cross-check the record's own persisted `teamId` against the requested
 * `teamId` → derive status (`effectiveChallengeStatus`, no decryption
 * needed) → exclude any record outside `allowedStatuses` → only then
 * decrypt the surviving records (skip, don't throw, on a decryption
 * failure) → sort newest-first → map to the minimal `TeamChallengeView`.
 */
async function fetchTeamChallenges(
  teamId: string,
  allowedStatuses: readonly ChallengeStatus[],
  deps: {
    reader: ChallengesReader;
    decryptText: (payload: EncryptedPayload) => string;
  },
): Promise<ListTeamChallengesResult> {
  let rawDocs: RawChallengeDoc[];
  try {
    rawDocs = await deps.reader.listRawForTeam(teamId);
  } catch {
    return { ok: false, error: "read_failed" };
  }

  const eligible = rawDocs
    .map(({ id, data }): Challenge | null => {
      const candidate = toCandidateChallenge(id, data);
      return isValidChallenge(candidate, { challengeId: id }) ? candidate : null;
    })
    .filter((challenge): challenge is Challenge => challenge !== null)
    // Defense-in-depth against a corrupted/cross-team record the query
    // shape alone shouldn't have returned (BR-10) — query scoping is
    // never trusted as the only protection.
    .filter((challenge) => challenge.teamId === teamId)
    .map((challenge) => ({ challenge, status: effectiveChallengeStatus(challenge) }))
    // Statuses outside the caller's allowed set are excluded *before* any
    // decryption call — an excluded record's `ciphertext` is never passed
    // to `decryptText`, so its plaintext is never computed at all (BR-37).
    .filter((entry) => allowedStatuses.includes(entry.status));

  const decrypted: Array<{ challenge: Challenge; status: ChallengeStatus; text: string }> = [];
  for (const entry of eligible) {
    let text: string;
    try {
      text = deps.decryptText({
        ciphertext: entry.challenge.ciphertext,
        iv: entry.challenge.iv,
        authTag: entry.challenge.authTag,
        keyVersion: entry.challenge.keyVersion,
      });
    } catch {
      // Skip, don't throw or fall back to ciphertext (BR-15) — never
      // logged, since the thrown error could echo ciphertext/IV bytes.
      continue;
    }
    decrypted.push({ challenge: entry.challenge, status: entry.status, text });
  }

  decrypted.sort((a, b) => {
    const diff = b.challenge.submittedAt.getTime() - a.challenge.submittedAt.getTime();
    if (diff !== 0) {
      return diff;
    }
    // Deterministic tie-break — never itself product-meaningful.
    return a.challenge.challengeId.localeCompare(b.challenge.challengeId);
  });

  const challenges: TeamChallengeView[] = decrypted.map(({ challenge, status, text }) => ({
    challengeId: challenge.challengeId,
    text,
    status,
    submittedAt: toDateOnly(challenge.submittedAt),
  }));

  return { ok: true, challenges };
}

export interface ListTeamChallengesForMemberDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: AuthorizeTeamAccessDeps["allowList"];
  authCollection?: AuthorizeTeamAccessDeps["collection"];
  reader?: ChallengesReader;
  decryptText?: (payload: EncryptedPayload) => string;
  membershipReader?: MembershipReader;
}

/**
 * Backs `/teams/[teamId]`'s team-facing challenge list (docs/features/
 * anonymous-challenges/SPEC.md — BR-9). Requires `authorizeTeamAccess` to
 * resolve to `"admin"` or `"member"` for `teamId` — the same broader
 * viewing boundary Managed Surveys' `getCurrentTeamSurvey` already uses;
 * `"denied"` is rejected `forbidden`, and a `read_failed` result from the
 * authorization check itself is never collapsed into `forbidden`.
 *
 * Returns only `open`/`resolved` challenges — **never** `archived`, for any
 * caller, regardless of role (BR-9, BR-37). This is a fixed, hardcoded
 * argument to the shared helper; nothing in this function's signature lets
 * a caller influence it (BR-36).
 *
 * No `teams/{teamId}.status` gate — a disabled team's existing challenges
 * remain listable (BR-14).
 *
 * Also returns `canSubmit`: whether *this* caller currently holds a genuine
 * `teamMemberships/{uid}__{teamId}` record, re-derived independently via
 * `resolveCanSubmit` using the exact membership semantics `submitChallenge`
 * itself requires — an app admin with no such record gets `canSubmit: false`
 * even though their broader `authorizeTeamAccess` result is `"admin"` (fixes
 * the composition gap where `/teams/[teamId]` previously showed the "Meld en
 * utfordring" submission form to any authorized viewer, including an
 * app-admin-only viewer who would always be rejected `forbidden` on actual
 * submission).
 */
export async function listTeamChallengesForMember(
  idToken: string,
  teamId: string,
  deps: ListTeamChallengesForMemberDeps = {},
): Promise<ListTeamChallengesForMemberResult> {
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

  const listResult = await fetchTeamChallenges(teamId, MEMBER_ALLOWED_STATUSES, {
    reader: deps.reader ?? getDefaultChallengesReader(),
    decryptText: deps.decryptText ?? decrypt,
  });
  if (!listResult.ok) {
    return listResult;
  }

  const canSubmit = await resolveCanSubmit(
    verified.identity.uid,
    teamId,
    deps.membershipReader ?? getDefaultMembershipReader(),
  );

  return { ok: true, challenges: listResult.challenges, canSubmit };
}

export interface ListTeamChallengesForAdminDeps {
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  reader?: ChallengesReader;
  decryptText?: (payload: EncryptedPayload) => string;
}

/**
 * Backs `/admin/teams/[teamId]`'s management section only — never called
 * from the team-facing page, regardless of the caller's own role
 * (docs/features/anonymous-challenges/SPEC.md — BR-35). Requires
 * `requireAppAdmin` — the same boundary every other admin-only management
 * action already uses; a non-admin caller, including an otherwise-
 * authorized team member, is rejected.
 *
 * Returns challenges of every derived status (`open`, `resolved`,
 * `archived`) — a fixed, hardcoded argument to the shared helper (BR-36).
 *
 * No `teams/{teamId}.status` gate — a disabled team's existing challenges
 * remain listable (BR-14).
 */
export async function listTeamChallengesForAdmin(
  idToken: string,
  teamId: string,
  deps: ListTeamChallengesForAdminDeps = {},
): Promise<ListTeamChallengesResult> {
  const admin = await requireAppAdmin(idToken, {
    verifyToken: deps.verifyToken,
    allowList: deps.allowList,
  });
  if (!admin.ok) {
    return { ok: false, error: admin.error };
  }

  return fetchTeamChallenges(teamId, ADMIN_ALLOWED_STATUSES, {
    reader: deps.reader ?? getDefaultChallengesReader(),
    decryptText: deps.decryptText ?? decrypt,
  });
}

import "server-only";
import { encrypt } from "../../../lib/encryption/encryption";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { runFencedTransaction, writeRefusalFor } from "../../auth/server/erasure-write-fence";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import type { ForumThreadRecord } from "../domain/forum-thread";
import { validateThreadBody, validateThreadTitle } from "../domain/thread-content";
import { type AuthRefusal, authRefusalFor } from "../../auth/server/auth-refusal";

const FORUM_THREADS_COLLECTION = "forumThreads";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * The write seam this operation depends on. Inside the transaction `add` creates the document with a pre-generated id and
 * returns that id, so the id is returned only from the attempt that commits (TASK-029).
 */
export interface ForumThreadsCollection {
  add(record: ForumThreadRecord): Promise<{ id: string }>;
}

/** The read seam for a real `teamMemberships/{uid}__{teamId}` record. Returns raw data; `createThread` validates it. */
export interface MembershipReader {
  getMembership(uid: string, teamId: string): Promise<unknown>;
}

/** The read seam for the owning team's fresh `status`. Mirrors `submitChallenge`'s `TeamStatusReader`. */
export interface TeamStatusReader {
  getTeamStatus(teamId: string): Promise<unknown>;
}

/** Everything one thread creation reads and writes, bound to one Firestore transaction (TASK-029). */
export interface ThreadTransactionScope {
  membershipReader: MembershipReader;
  teamStatusReader: TeamStatusReader;
  collection: ForumThreadsCollection;
}

/**
 * Runs `work` in one transaction whose first operation is the erasure fence read for `uid` (BR-4(b), TASK-004). An existing
 * record refuses before `work` runs. Firestore may re-run `work`, so it must be retry-safe.
 */
export type ThreadTransactionRunner = <T>(uid: string, work: (scope: ThreadTransactionScope) => Promise<T>) => Promise<T>;

/** Production runner: one Admin SDK transaction. The membership and team reads and the thread create share it. */
function runThreadTransaction<T>(uid: string, work: (scope: ThreadTransactionScope) => Promise<T>): Promise<T> {
  const db = getFirestoreDb();
  return runFencedTransaction(db, uid, (tx) =>
    work({
      membershipReader: {
        async getMembership(memberUid, teamId) {
          const snapshot = await tx.get(db.collection(MEMBERSHIPS_COLLECTION).doc(membershipDocId(memberUid, teamId)));
          return snapshot.exists ? snapshot.data() : undefined;
        },
      },
      teamStatusReader: {
        async getTeamStatus(teamId) {
          const snapshot = await tx.get(db.collection(TEAMS_COLLECTION).doc(teamId));
          return snapshot.exists ? snapshot.data()?.status : undefined;
        },
      },
      collection: {
        async add(record) {
          const ref = db.collection(FORUM_THREADS_COLLECTION).doc();
          tx.create(ref, record);
          return { id: ref.id };
        },
      },
    }),
  );
}

export type CreateThreadResult =
  | { ok: true; threadId: string }
  | {
      ok: false;
      error:
        | "sign_in_required" | AuthRefusal
        | "invalid_input"
        | "forbidden"
        | "team_not_found"
        | "team_disabled"
        | "encryption_failed"
        | "erasure_in_progress"
        | "persistence_failed";
    };

export interface CreateThreadDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  /** Tests inject a transaction runner over fakes. Production uses the Admin SDK transaction. */
  runThreadTransaction?: ThreadTransactionRunner;
}

/**
 * Creates one thread for `teamId` (docs/features/team-forum/SPEC.md — "Server operations" → `createThread`; BR-1 through BR-7,
 * BR-9, BR-47). `teamId` is the caller's trusted route scope; `authorUid` is always the verified caller's own `uid`.
 *
 * Order: verify the ID token (`sign_in_required`) → validate `rawTitle` and `rawBody` (`invalid_input`, nothing read yet) → one
 * transaction whose first operation is the erasure fence read for the caller (TASK-029, BR-4(b)). Inside it: a real
 * `teamMemberships/{uid}__{teamId}` record (`forbidden`, BR-1, not `authorizeTeamAccess`, so an app admin without membership
 * cannot create content) → a fresh `teams/{teamId}.status` (`team_not_found` for a missing or malformed status, `team_disabled`
 * for any other non-active status, BR-7) → encrypt `{title, body}` with a fresh IV → one `forumThreads` create.
 *
 * The membership and team reads are in the same transaction as the create, so a membership or team change before commit makes
 * Firestore retry rather than create from a stale check. A fence refusal returns `erasure_in_progress` with no read after it
 * and no write.
 *
 * Returns `{ok: true, threadId}`: the id of the document the committed attempt created.
 *
 * Fails closed: a read, transaction or write error maps to `persistence_failed`; an `encrypt` failure to `encryption_failed`.
 * Neither falls back to plaintext, and neither logs detail from the thrown error (BR-36).
 */
export async function createThread(
  idToken: string,
  teamId: string,
  rawTitle: unknown,
  rawBody: unknown,
  deps: CreateThreadDeps = {},
): Promise<CreateThreadResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: verified.error === "invalid_token" ? "sign_in_required" : authRefusalFor(verified) };
  }

  const validatedTitle = validateThreadTitle(rawTitle);
  if (!validatedTitle.ok) {
    return { ok: false, error: "invalid_input" };
  }

  const validatedBody = validateThreadBody(rawBody);
  if (!validatedBody.ok) {
    return { ok: false, error: "invalid_input" };
  }

  const runTransaction = deps.runThreadTransaction ?? runThreadTransaction;
  const createdAt = deps.now ?? new Date();
  try {
    return await runTransaction(verified.identity.uid, (scope) =>
      createThreadInTransaction(scope, verified.identity.uid, teamId, validatedTitle.title, validatedBody.body, createdAt),
    );
  } catch (error) {
    // A fence refusal is `erasure_in_progress`; any other failure is `persistence_failed`. The raw error is never returned.
    return { ok: false, error: writeRefusalFor(error) };
  }
}

/** The reads, checks and the single create of one thread, run inside the transaction. */
async function createThreadInTransaction(
  scope: ThreadTransactionScope,
  authorUid: string,
  teamId: string,
  title: string,
  body: string,
  createdAt: Date,
): Promise<CreateThreadResult> {
  // Read errors are not caught here: a thrown error lets Firestore retry the transaction on contention, and createThread maps
  // any non-refusal failure to persistence_failed.
  const rawMembership = await scope.membershipReader.getMembership(authorUid, teamId);
  if (!isValidMembershipFor(rawMembership, { uid: authorUid, teamId })) {
    return { ok: false, error: "forbidden" };
  }

  const rawTeamStatus = await scope.teamStatusReader.getTeamStatus(teamId);
  if (!isValidTeamStatus(rawTeamStatus)) {
    // "No such team" (`undefined`) and a malformed status both fail closed, never assumed "active" (as `submitChallenge` does).
    return { ok: false, error: "team_not_found" };
  }
  if (rawTeamStatus !== "active") {
    return { ok: false, error: "team_disabled" };
  }

  let encrypted;
  try {
    encrypted = encrypt(JSON.stringify({ title, body }));
  } catch {
    return { ok: false, error: "encryption_failed" };
  }

  const record: ForumThreadRecord = {
    teamId,
    authorUid,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    createdAt,
  };

  const { id } = await scope.collection.add(record);
  return { ok: true, threadId: id };
}

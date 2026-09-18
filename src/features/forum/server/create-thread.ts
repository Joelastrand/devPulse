import "server-only";
import { encrypt } from "../../../lib/encryption/encryption";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isValidTeamStatus } from "../../teams/domain/team";
import { isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import type { ForumThreadRecord } from "../domain/forum-thread";
import { validateThreadBody, validateThreadTitle } from "../domain/thread-content";

const FORUM_THREADS_COLLECTION = "forumThreads";
const TEAMS_COLLECTION = "teams";
const MEMBERSHIPS_COLLECTION = "teamMemberships";

/**
 * The write seam this operation depends on, satisfied in production by a
 * Firestore `CollectionReference` (whose `.add()` assigns the opaque,
 * auto-generated `threadId`) and by an in-memory fake in tests.
 */
export interface ForumThreadsCollection {
  add(record: ForumThreadRecord): Promise<{ id: string }>;
}

function getDefaultForumThreadsCollection(): ForumThreadsCollection {
  return getFirestoreDb().collection(FORUM_THREADS_COLLECTION);
}

/**
 * The read seam for a real `teamMemberships/{uid}__{teamId}` record,
 * satisfied in production by a Firestore document read and by an in-memory
 * fake in tests. Returns raw, unvalidated data — `createThread` is
 * responsible for validating it (via `isValidMembershipFor`) before trusting
 * it, exactly as `submitChallenge` already does for the same field.
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
 * tests. Mirrors `submitChallenge`'s `TeamStatusReader` exactly.
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

export type CreateThreadResult =
  | { ok: true; threadId: string }
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

export interface CreateThreadDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  membershipReader?: MembershipReader;
  teamStatusReader?: TeamStatusReader;
  collection?: ForumThreadsCollection;
}

/**
 * Creates one thread for `teamId` (docs/features/team-forum/SPEC.md —
 * "Server operations" → `createThread`; BR-1 through BR-7, BR-9, BR-47).
 * `teamId` is always the caller's trusted server/route scope — this
 * function accepts no `teamId`-shaped request field, so there is nothing in
 * `rawTitle`/`rawBody` for a caller to override it with; `authorUid` is
 * always the verified caller's own `uid`, never client-supplied.
 *
 * Order of checks, in this exact sequence (SPEC — "Server operations"):
 * verify the ID token (`sign_in_required` if absent/invalid) → validate
 * `rawTitle` and `rawBody` (TASK-001's `validateThreadTitle`/
 * `validateThreadBody`, reused unchanged — `invalid_input`, nothing read or
 * written yet) → confirm a real `teamMemberships/{uid}__{teamId}` record
 * exists (BR-1) via `isValidMembershipFor` — deliberately **not**
 * `authorizeTeamAccess`, whose `"admin"` result would incorrectly grant an
 * app admin with no real membership eligibility to create content (mirrors
 * `submitChallenge`'s identical BR-1 handling) → re-read
 * `teams/{teamId}.status` fresh (`team_not_found`/`team_disabled` if not
 * `active`, BR-7) → encrypt `JSON.stringify({title, body})` server-side with
 * a fresh IV → persist one `forumThreads/{auto-id}` document.
 *
 * No Firestore transaction is used — a single-document write with no
 * cross-document invariant to protect (SPEC "Data model" explains why no
 * `replyCount` or other counter exists to require one).
 *
 * Returns `{ok: true, threadId}` — unlike `submitChallenge`, the generated
 * id is returned here, since a thread's own author needs a durable handle
 * to it even after it ages out of `listTeamThreads`'s 200-newest window
 * (SPEC "Reply capacity").
 *
 * Fails closed on every infrastructure failure: a Firestore read error maps
 * to `persistence_failed`; an `encrypt` failure (e.g. missing
 * `ENCRYPTION_KEY`) maps to `encryption_failed` — neither path ever falls
 * back to plaintext, and neither is ever logged with any detail from the
 * thrown error (BR-36).
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
    return { ok: false, error: "sign_in_required" };
  }

  const validatedTitle = validateThreadTitle(rawTitle);
  if (!validatedTitle.ok) {
    return { ok: false, error: "invalid_input" };
  }

  const validatedBody = validateThreadBody(rawBody);
  if (!validatedBody.ok) {
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
    // `submitChallenge` does for the same field, never assuming "active"
    // for an un-interpretable read.
    return { ok: false, error: "team_not_found" };
  }
  if (rawTeamStatus !== "active") {
    return { ok: false, error: "team_disabled" };
  }

  let encrypted;
  try {
    encrypted = encrypt(JSON.stringify({ title: validatedTitle.title, body: validatedBody.body }));
  } catch {
    return { ok: false, error: "encryption_failed" };
  }

  const record: ForumThreadRecord = {
    teamId,
    authorUid: verified.identity.uid,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    createdAt: deps.now ?? new Date(),
  };

  const collection = deps.collection ?? getDefaultForumThreadsCollection();
  try {
    const { id } = await collection.add(record);
    return { ok: true, threadId: id };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

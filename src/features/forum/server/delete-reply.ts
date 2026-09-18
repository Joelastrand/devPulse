import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { verifyIdToken, type VerifyIdTokenDeps } from "../../auth/server/verify-identity";
import { isAppAdmin, type IsAppAdminDeps } from "../../teams/domain/app-admin";
import { isForumReplyDeleted, isValidForumReply, type ForumReplyRecord } from "../domain/forum-reply";

const FORUM_REPLIES_COLLECTION = "forumReplies";

/** A raw Firestore document read, abstracted so a test double never needs a real `firebase-admin` snapshot. */
export interface DeleteReplyDocSnapshot {
  exists: boolean;
  data(): unknown;
}

/**
 * The read/write seam for the target `forumReplies/{replyId}` document
 * itself, satisfied in production by direct Firestore document calls and by
 * an in-memory fake in tests. `tombstone` erases the reply's content-bearing
 * and identity fields (docs/features/team-forum/SPEC.md — BR-26) — the
 * default implementation uses Firestore's own `FieldValue.delete()` on each
 * one, a genuine field removal, never merely setting them to `undefined`/
 * `null`.
 */
export interface ForumReplyDocStore {
  get(replyId: string): Promise<DeleteReplyDocSnapshot>;
  tombstone(replyId: string, deletedAt: Date, deletedBy: string): Promise<void>;
}

function getDefaultForumReplyDocStore(): ForumReplyDocStore {
  return {
    async get(replyId) {
      const snapshot = await getFirestoreDb().collection(FORUM_REPLIES_COLLECTION).doc(replyId).get();
      return { exists: snapshot.exists, data: () => snapshot.data() };
    },
    async tombstone(replyId, deletedAt, deletedBy) {
      await getFirestoreDb()
        .collection(FORUM_REPLIES_COLLECTION)
        .doc(replyId)
        .update({
          deletedAt,
          deletedBy,
          ciphertext: FieldValue.delete(),
          iv: FieldValue.delete(),
          authTag: FieldValue.delete(),
          keyVersion: FieldValue.delete(),
          authorUid: FieldValue.delete(),
        });
    },
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
  return value;
}

/**
 * Maps raw Firestore reply document data into the candidate shape
 * `isValidForumReply` expects — mirrors `get-thread-with-replies.ts`'s
 * identical helper. Deliberately does not add a `deletedAt` key when the
 * source document has none, so the active/tombstone shape discrimination
 * (`"deletedAt" in record`) is preserved exactly.
 */
function toCandidateReply(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  const candidate: Record<string, unknown> = { ...record, createdAt: toDateOrUndefined(record.createdAt) };
  if ("deletedAt" in record) {
    candidate.deletedAt = toDateOrUndefined(record.deletedAt);
  }
  return candidate;
}

export type DeleteReplyResult =
  | { ok: true }
  | { ok: false; error: "sign_in_required" | "forbidden" | "not_found" | "persistence_failed" };

export interface DeleteReplyDeps {
  now?: Date;
  verifyToken?: VerifyIdTokenDeps["verifyToken"];
  allowList?: IsAppAdminDeps["allowList"];
  docs?: ForumReplyDocStore;
}

/**
 * Content-erases a single reply into its terminal tombstone shape (docs/
 * features/team-forum/SPEC.md — "Server operations" → `deleteReply`; BR-23,
 * BR-26 through BR-28, BR-32, BR-35, BR-56). This never hard-deletes the
 * reply's document — it is retained, stripped of content and identity,
 * solely to preserve its position in `getThreadWithReplies`'s reply list.
 *
 * Order of checks, in this exact sequence:
 * verify the ID token (`sign_in_required`) → fetch `forumReplies/{replyId}`
 * and validate it (`isValidForumReply`, TASK-001, BR-56); missing, malformed,
 * or a `teamId`/`threadId` mismatch against the route scope all resolve to
 * the identical `not_found` (BR-32, BR-35) — checked *before* the tombstone
 * shortcut below, so a wrong-team/wrong-thread tombstoned reply is never
 * distinguishable from one that never existed, and never becomes an
 * existence oracle → **already tombstoned** (`isForumReplyDeleted`) →
 * idempotent `{ok: true}` for **any authenticated caller**, no write, no
 * further authorization check at all (BR-27, revised) → otherwise (still
 * active): authorize `isAppAdmin(identity)` **or** `reply.authorUid ===
 * identity.uid`, else `forbidden` (BR-23).
 *
 * **BR-27's idempotent no-op does not depend on caller identity once the
 * record is a validated, correctly-scoped tombstone.** A tombstone retains
 * no `authorUid` (BR-26), so there is no persisted identity left to
 * re-authorize a repeat call against — checking tombstone state *before*
 * authorization (rather than after) means a caller retrying a lost or
 * dropped response is never asked to re-prove an authorship the document
 * can no longer attest to, and no identity is ever reconstructed or
 * reintroduced to perform that check. This is deliberately different from
 * `deleteThread`'s revised `not_found`-on-repeat contract: a reply's
 * document still exists after tombstoning, so there is a state to observe
 * and confirm idempotently; a hard-deleted thread has no document left at
 * all to observe.
 *
 * Otherwise (an active reply): one `update()` sets `deletedAt`/`deletedBy`
 * and removes `ciphertext`/`iv`/`authTag`/`keyVersion`/`authorUid` via
 * Firestore `FieldValue.delete()` on each (BR-26) — a single atomic
 * document write, not a transaction.
 *
 * `deletedBy` is always the verified caller's own `uid` — never
 * client-supplied (no such field exists on this function's signature). No
 * `teams/{teamId}.status` read — deletion is never gated on the owning
 * team's `active`/`disabled` status (BR-31).
 *
 * Fails closed on any Firestore error → `persistence_failed`.
 */
export async function deleteReply(
  idToken: string,
  teamId: string,
  threadId: string,
  replyId: string,
  deps: DeleteReplyDeps = {},
): Promise<DeleteReplyResult> {
  const verified = await verifyIdToken(idToken, { verifyToken: deps.verifyToken });
  if (!verified.ok) {
    return { ok: false, error: "sign_in_required" };
  }

  const docs = deps.docs ?? getDefaultForumReplyDocStore();

  let snapshot: DeleteReplyDocSnapshot;
  try {
    snapshot = await docs.get(replyId);
  } catch {
    return { ok: false, error: "persistence_failed" };
  }

  const candidate = toCandidateReply(snapshot.exists ? snapshot.data() : undefined);
  if (!isValidForumReply(candidate) || candidate.teamId !== teamId || candidate.threadId !== threadId) {
    // Missing, malformed, wrong-team, and wrong-thread all resolve to the
    // identical not_found (BR-32, BR-35) — checked before the tombstone
    // shortcut below, so a wrong-team/wrong-thread tombstone can never be
    // confirmed to exist via an idempotent-success response either.
    return { ok: false, error: "not_found" };
  }
  const reply: ForumReplyRecord = candidate;

  if (isForumReplyDeleted(reply)) {
    // Idempotent no-op for any authenticated caller (BR-27, revised) — the
    // document already carries no content or identity to erase again, no
    // field changes, and no write at all. There is no authorUid left to
    // check a caller against, and none is reconstructed to perform one.
    return { ok: true };
  }

  const admin = isAppAdmin(verified.identity, { allowList: deps.allowList });
  if (!admin && reply.authorUid !== verified.identity.uid) {
    return { ok: false, error: "forbidden" };
  }

  try {
    await docs.tombstone(replyId, deps.now ?? new Date(), verified.identity.uid);
    return { ok: true };
  } catch {
    return { ok: false, error: "persistence_failed" };
  }
}

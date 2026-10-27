import "server-only";
import { READ_WINDOW } from "../domain/conversation-constants";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import {
  CONVERSATION_RAW_READ_LIMIT,
  OWNER_CONVERSATIONS_SUBCOLLECTION,
  PARTICIPATION_INDEX_SUBCOLLECTION,
  USER_DEVELOPMENT_COLLECTION,
  assertConversationIdSegment,
  assertUidSegment,
  ownerDocumentPath,
  participationDocumentPath,
  patchedOwnerKeys,
  toOwnerRecord,
  toParticipationRecord,
  type ConversationStore,
  type ConversationTransaction,
  type MissingCreatedAtScan,
  type OwnerDocumentPatch,
  type OwnerDocumentWrite,
  type ParticipationIndexWrite,
  type RawConversationData,
  type RawConversationDoc,
  type RawConversationWindow,
} from "./conversation-store-types";

/**
 * In-memory {@link ConversationStore} for tests of later operations (server-only, Firebase-free). It uses the same path
 * segments, the same window and count rules, and the same transaction semantics as the Admin store, so later tests run
 * against real behaviour. It grants nothing, repairs nothing and maps no errors.
 *
 * Documents are keyed by the joined path segments. Every value leaving the fake is a copy, so a caller cannot change
 * stored state through a returned object.
 */

type Records = Map<string, Record<string, unknown>>;

/** Test-only seams. Production code never receives this type. */
export interface FakeConversationStore extends ConversationStore {
  /** Test only: stores a raw document as given, bypassing the canonical write shape, to exercise malformed reads. */
  seedRawOwner(ownerUid: string, conversationId: string, data: RawConversationData): void;
  /** Test only: stores a raw index document as given, bypassing the canonical write shape. */
  seedRawParticipation(callerUid: string, conversationId: string, data: RawConversationData): void;
  /**
   * Test only: makes the next `count` transaction attempts end in a commit conflict, as Firestore reports when a read
   * changed under it. The attempt's writes are discarded and `work` runs again. `beforeRetry` runs after each discarded
   * attempt and is awaited, so a test can model the concurrent change that caused the conflict, including by running a
   * real operation that commits. Deterministic: no timing is involved. A hook that runs a transaction consumes no
   * conflict unless one is scheduled for it, because each scheduled conflict is spent before its hook runs.
   */
  scheduleCommitConflicts(count: number, beforeRetry?: (discardedAttempt: number) => void | Promise<void>): void;
}

/** Fixtures the transaction's team and membership reads see. Shared with the operations' non-transactional reader. */
export function emptyTeamFixtures(): FakeTeamEligibilityState {
  return { teamStatus: {}, memberships: {} };
}

const keyOf = (segments: readonly string[]) => segments.join("/");

/** Copies a record shallowly, copying each `Date` so later mutation of the caller's value cannot reach stored state. */
function copyRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value instanceof Date ? new Date(value) : value]));
}

/** Sort key for the `desc` windows: the instant in milliseconds. Non-`Date` values are not used as timestamps. */
const instant = (value: unknown): number => (value instanceof Date ? value.getTime() : Number.NaN);

/** Direct children of one subtree (`parent/uid/subcollection/`), id order. Deeper paths are not documents of it. */
function childrenOf(records: Records, prefix: string): Array<{ id: string; data: Record<string, unknown> }> {
  return [...records.entries()]
    .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
    .map(([key, data]) => ({ id: key.slice(prefix.length), data }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * `orderBy field desc` with the document id as the tie-break (Firestore appends the id in the last order's direction).
 * A document without the field is not in the query result, as in Firestore.
 */
function orderedWindow(records: Records, prefix: string, field: string): RawConversationWindow {
  const matching = childrenOf(records, prefix)
    .filter((doc) => doc.data[field] !== undefined)
    .sort((a, b) => instant(b.data[field]) - instant(a.data[field]) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const queried = matching.slice(0, CONVERSATION_RAW_READ_LIMIT);
  return {
    docs: queried.slice(0, READ_WINDOW).map((doc): RawConversationDoc => ({ id: doc.id, data: copyRecord(doc.data) })),
    rawCount: queried.length,
  };
}

function missingCreatedAtScan(records: Records, prefix: string): MissingCreatedAtScan {
  const queried = childrenOf(records, prefix).slice(0, CONVERSATION_RAW_READ_LIMIT);
  return {
    missingCreatedAtIds: queried
      .slice(0, READ_WINDOW)
      .filter((doc) => doc.data.createdAt === undefined)
      .map((doc) => doc.id),
    rawCount: queried.length,
  };
}

/**
 * The canonical patch: only canonical keys the caller set (`null` clears). Built from the key list, never spread. The
 * patched values are copied as well, so a `Date` the caller keeps cannot change stored state (the Admin store writes a
 * Timestamp snapshot).
 */
function applyOwnerPatch(existing: Record<string, unknown>, patch: OwnerDocumentPatch): Record<string, unknown> {
  const changes = copyRecord(Object.fromEntries(patchedOwnerKeys(patch).map((key) => [key, patch[key]])));
  return { ...copyRecord(existing), ...changes };
}

/**
 * Creates an in-memory store. `generateId` supplies new owner ids (the default is deterministic and valid). `teams` is the
 * team and membership fixture that the transaction's `teamEligibility` reads; pass the same object to the operation's
 * own reader so both see one state. Each call to `createFakeConversationStore` starts empty, so tests do not share state.
 *
 * Concurrency limits: an attempt runs to completion on one thread, so no other write can interleave inside it. Commit
 * conflicts are scheduled, not raced. Team and membership fixtures are read live, so a change made between attempts is
 * seen by the retry, but a change made during an attempt is not isolated from that attempt's reads.
 */
export function createFakeConversationStore(
  options: { generateId?: () => string; teams?: FakeTeamEligibilityState } = {},
): FakeConversationStore {
  let records: Records = new Map();
  let sequence = 0;
  const teams = options.teams ?? emptyTeamFixtures();
  let conflictsLeft = 0;
  let beforeRetryHook: ((discardedAttempt: number) => void | Promise<void>) | undefined;
  const generateId = options.generateId ?? (() => {
    sequence += 1;
    return `fake-${String(sequence).padStart(6, "0")}`;
  });

  const ownerPrefix = (ownerUid: string) => `${USER_DEVELOPMENT_COLLECTION}/${ownerUid}/${OWNER_CONVERSATIONS_SUBCOLLECTION}/`;
  const indexPrefix = (callerUid: string) => `${USER_DEVELOPMENT_COLLECTION}/${callerUid}/${PARTICIPATION_INDEX_SUBCOLLECTION}/`;

  return {
    newOwnerId(ownerUid) {
      assertUidSegment(ownerUid);
      const id = generateId();
      assertConversationIdSegment(id);
      return id;
    },

    async listOwnerWindow(ownerUid) {
      assertUidSegment(ownerUid);
      return orderedWindow(records, ownerPrefix(ownerUid), "createdAt");
    },

    async scanOwnerMissingCreatedAt(ownerUid) {
      assertUidSegment(ownerUid);
      return missingCreatedAtScan(records, ownerPrefix(ownerUid));
    },

    async countOwner(ownerUid) {
      assertUidSegment(ownerUid);
      return childrenOf(records, ownerPrefix(ownerUid)).length;
    },

    async getOwner(ownerUid, conversationId) {
      const stored = records.get(keyOf(ownerDocumentPath(ownerUid, conversationId)));
      return stored === undefined ? undefined : copyRecord(stored);
    },

    async listParticipationWindow(callerUid) {
      assertUidSegment(callerUid);
      return orderedWindow(records, indexPrefix(callerUid), "invitedAt");
    },

    async countParticipation(callerUid) {
      assertUidSegment(callerUid);
      return childrenOf(records, indexPrefix(callerUid)).length;
    },

    async getParticipation(callerUid, conversationId) {
      const stored = records.get(keyOf(participationDocumentPath(callerUid, conversationId)));
      return stored === undefined ? undefined : copyRecord(stored);
    },

    async runTransaction(work) {
      // Each attempt runs `work` against a fresh draft. The draft is committed only when `work` resolves and no
      // scheduled conflict discards it, as a Firestore transaction does. A discarded attempt is re-run from the start.
      for (let attempt = 1; ; attempt += 1) {
        const draft: Records = new Map(records);
        const result = await work(transactionOver(draft));
        if (conflictsLeft > 0) {
          conflictsLeft -= 1;
          await beforeRetryHook?.(attempt);
          continue;
        }
        records = draft;
        return result;
      }
    },

    scheduleCommitConflicts(count, beforeRetry) {
      conflictsLeft = count;
      beforeRetryHook = beforeRetry;
    },

    seedRawOwner(ownerUid, conversationId, data) {
      records.set(keyOf(ownerDocumentPath(ownerUid, conversationId)), copyRecord(data));
    },

    seedRawParticipation(callerUid, conversationId, data) {
      records.set(keyOf(participationDocumentPath(callerUid, conversationId)), copyRecord(data));
    },
  };

  /** One attempt's transaction over `draft`. Reads must precede writes, as in Firestore. */
  function transactionOver(draft: Records): ConversationTransaction {
    let wrote = false;
    const readAfterWrite = () => new Error("reads must precede writes in a transaction");
    return {
      teamEligibility: createFakeTeamEligibilityReader(teams),
      async getOwner(ownerUid, conversationId) {
        if (wrote) throw readAfterWrite();
        const stored = draft.get(keyOf(ownerDocumentPath(ownerUid, conversationId)));
        return stored === undefined ? undefined : copyRecord(stored);
      },
      createOwner(ownerUid, conversationId, doc: OwnerDocumentWrite) {
        wrote = true;
        const key = keyOf(ownerDocumentPath(ownerUid, conversationId));
        if (draft.has(key)) throw new Error("owner document already exists");
        draft.set(key, copyRecord(toOwnerRecord(doc)));
      },
      setOwner(ownerUid, conversationId, doc: OwnerDocumentWrite) {
        wrote = true;
        draft.set(keyOf(ownerDocumentPath(ownerUid, conversationId)), copyRecord(toOwnerRecord(doc)));
      },
      updateOwner(ownerUid, conversationId, patch: OwnerDocumentPatch) {
        wrote = true;
        const key = keyOf(ownerDocumentPath(ownerUid, conversationId));
        const existing = draft.get(key);
        if (existing === undefined) throw new Error("owner document does not exist");
        draft.set(key, applyOwnerPatch(existing, patch));
      },
      deleteOwner(ownerUid, conversationId) {
        wrote = true;
        draft.delete(keyOf(ownerDocumentPath(ownerUid, conversationId)));
      },
      async getParticipation(callerUid, conversationId) {
        if (wrote) throw readAfterWrite();
        const stored = draft.get(keyOf(participationDocumentPath(callerUid, conversationId)));
        return stored === undefined ? undefined : copyRecord(stored);
      },
      setParticipation(callerUid, conversationId, index: ParticipationIndexWrite) {
        wrote = true;
        draft.set(keyOf(participationDocumentPath(callerUid, conversationId)), copyRecord(toParticipationRecord(index)));
      },
      deleteParticipation(callerUid, conversationId) {
        wrote = true;
        draft.delete(keyOf(participationDocumentPath(callerUid, conversationId)));
      },
    };
  }
}

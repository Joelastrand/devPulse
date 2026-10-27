import "server-only";
import { getFirestoreDb } from "../../../lib/firebase/admin";
import { arrangeAssignableMembers, type AssignableCandidate } from "../../teams/domain/assignable-ordinals";
import { memberRefOf } from "../../teams/domain/member-ref";
import { extractMemberUid, isValidMembershipFor, membershipDocId } from "../../teams/domain/team-membership";
import { isConversationId } from "../domain/conversation-id";
import type { ConversationStore } from "./conversation-store-types";
import { SELECTABLE_MEMBERS_MAX } from "./member-ref-binding";
import { classifyOwnerDocument, type OwnerReadCodec } from "./owner-read";
import { productionDisplayNames } from "./participant-presentation";
import { createFirestoreTeamEligibilityReader, readGenuineActiveMembership, type TeamEligibilityReader } from "./team-eligibility";

/**
 * The owner's selector read (SPEC Amendment 2026-10-19, TASK-029 review finding I-1). Discovery only: the result grants
 * nothing, and the owner's PATCH re-resolves the chosen `memberRef` and re-checks the owner and the candidate on every write.
 *
 * Authority is the D2 owner predicate, not the generic team endpoint's `authorizeTeamAccess`. The caller must own the
 * conversation, the conversation must have a team, and `readGenuineActiveMembership` must succeed for the caller, which
 * needs an active team and the caller's own genuine membership. App-admin, lead, role, e-mail and display name never
 * qualify or bypass. Names are read only after that predicate succeeds.
 *
 * Bounded: one `teamMemberships where teamId ==` query with `limit(SELECTABLE_MEMBERS_MAX + 1)`, the same shape the write
 * path uses. Only the first `SELECTABLE_MEMBERS_MAX` raw rows are examined. Every raw row in that window consumes a slot,
 * valid or not, and there is no refill. A row is offered only when it is the exact membership document of its uid for this
 * team and its `memberRef` is valid and unique in the window. Any other row is omitted and counted in `unavailableCount`.
 */

/** One raw row of the team membership query: its document id and its unvalidated data. */
export interface SelectableRow {
  id: string;
  data: unknown;
}

/** The team reads of `readGenuineActiveMembership`, plus the bounded membership query. Raw data only. */
export interface SelectableMembersReader extends TeamEligibilityReader {
  listMembershipDocuments(teamId: string, limit: number): Promise<SelectableRow[]>;
}

export interface SelectableMembersDeps {
  store: ConversationStore;
  /** The owner classification seam: the key probe and the authenticated decrypt (BR-33, BR-53). */
  codec: OwnerReadCodec;
  reader: SelectableMembersReader;
  /** Production uses the D2 roster name seam; tests inject a fake. */
  getNames?: (uids: readonly string[]) => Promise<Map<string, string>>;
}

/** The selector DTO member. Exactly these keys: no uid, e-mail, role or membership id. */
export interface SelectableMember {
  memberRef: string;
  displayName: string | null;
  ordinal: number | null;
  isSelf: boolean;
}

export type ReadSelectableMembersResult =
  | { ok: true; members: SelectableMember[]; unavailableCount: number; truncated: boolean }
  | { ok: false; error: "conversation_not_found" | "invalid_participant" | "conversation_completed" | "persistence_failed" };

const NOT_FOUND: ReadSelectableMembersResult = { ok: false, error: "conversation_not_found" };
const NO_TEAM: ReadSelectableMembersResult = { ok: false, error: "invalid_participant" };
const COMPLETED: ReadSelectableMembersResult = { ok: false, error: "conversation_completed" };
const FAILED: ReadSelectableMembersResult = { ok: false, error: "persistence_failed" };

/** A row that passes every offering test. `joinedAt` is a private ranking input, never returned. */
interface OfferedRow {
  uid: string;
  memberRef: string;
  joinedAt: number | null;
}

/** The offering tests of Amendment rule 11. `null` means the row is omitted and counted, with nothing returned about it. */
function offeredRow(row: SelectableRow, teamId: string): OfferedRow | null {
  const uid = extractMemberUid(row.data);
  if (uid === null || row.id !== membershipDocId(uid, teamId)) return null;
  if (!isValidMembershipFor(row.data, { uid, teamId })) return null;
  const memberRef = memberRefOf(row.data);
  if (memberRef === null) return null;
  const createdAt = (row.data as Record<string, unknown>).createdAt;
  const joinedAt = createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : null;
  return { uid, memberRef, joinedAt };
}

/**
 * Reads the owner's selectable members for one of their conversations. Every refusal is a stable code, and no roster or
 * name is returned on any refusal or failure.
 */
export async function readSelectableMembers(
  ownerUid: string,
  conversationId: string,
  deps: SelectableMembersDeps,
): Promise<ReadSelectableMembersResult> {
  // A malformed id cannot name a document, so it is refused before any read (D2-SI-15).
  if (!isConversationId(conversationId)) return NOT_FOUND;

  try {
    // BR-53: the key probe runs before any document is decrypted.
    if (!deps.codec.probeKey().ok) return FAILED;

    // The caller's own owner subtree is the ownership test: a foreign or absent document is not found here.
    const raw = await deps.store.getOwner(ownerUid, conversationId);
    if (raw === undefined) return NOT_FOUND;
    const classification = classifyOwnerDocument(raw, deps.codec);
    if (classification.kind !== "valid") return NOT_FOUND;
    const { teamId, status } = classification.record;

    if (teamId === null) return NO_TEAM;
    if (status === "completed") return COMPLETED;

    // Owner eligibility (Amendment rule 7): an active team and the caller's own genuine membership. No admin bypass.
    const owner = await readGenuineActiveMembership(ownerUid, teamId, deps.reader);
    if (!owner.ok) return owner.error === "read_failed" ? FAILED : NOT_FOUND;

    const rows = await deps.reader.listMembershipDocuments(teamId, SELECTABLE_MEMBERS_MAX + 1);
    const truncated = rows.length > SELECTABLE_MEMBERS_MAX;
    const window = rows.slice(0, SELECTABLE_MEMBERS_MAX);

    const parsed = window.map((row) => offeredRow(row, teamId));
    const refCounts = new Map<string, number>();
    for (const row of parsed) {
      if (row !== null) refCounts.set(row.memberRef, (refCounts.get(row.memberRef) ?? 0) + 1);
    }
    const offered = parsed.filter((row): row is OfferedRow => row !== null && refCounts.get(row.memberRef) === 1);
    const unavailableCount = window.length - offered.length;

    // Names are read only now, after owner eligibility, and only for offered uids (Amendment rule 14).
    const names = offered.length === 0 ? new Map<string, string>() : await (deps.getNames ?? productionDisplayNames)(offered.map((row) => row.uid));

    const candidates = offered.map(
      (row): AssignableCandidate & { uid: string } => ({
        uid: row.uid,
        memberRef: row.memberRef,
        displayName: names.get(row.uid) ?? null,
        joinedAt: row.joinedAt,
        isSelf: row.uid === ownerUid,
      }),
    );
    const members = arrangeAssignableMembers(candidates).map(
      ({ memberRef, displayName, ordinal, isSelf }): SelectableMember => ({ memberRef, displayName, ordinal, isSelf }),
    );

    return { ok: true, members, unavailableCount, truncated };
  } catch {
    // Any read, key, classification or name failure is operational. It is never a partial roster (BR-47, BR-53).
    return FAILED;
  }
}

const MEMBERSHIPS_COLLECTION = "teamMemberships";

/** A Firestore `Timestamp` becomes a `Date`, so the ranking input is a plain instant. Anything else is passed through. */
function asDate(value: unknown): unknown {
  return typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as { toDate(): Date }).toDate()
    : value;
}

/** The production reader: the TASK-006 team reads, plus the membership query the write path also uses (BR-8, BR-36). */
export function createFirestoreSelectableMembersReader(): SelectableMembersReader {
  return {
    ...createFirestoreTeamEligibilityReader(),
    async listMembershipDocuments(teamId, limit) {
      const snapshot = await getFirestoreDb()
        .collection(MEMBERSHIPS_COLLECTION)
        .where("teamId", "==", teamId)
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return { id: doc.id, data: { ...data, createdAt: asDate(data.createdAt) } };
      });
    },
  };
}

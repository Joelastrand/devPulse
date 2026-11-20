import "server-only";
import { READ_WINDOW } from "../domain/conversation-constants";
import { isConversationId } from "../domain/conversation-id";
import { classifyStoredShape } from "../domain/stored-owner-conversation";
import { parseStoredParticipationIndex } from "../domain/stored-participation-index";
import { authorizeParticipant } from "./authorize-participant";
import { getDefaultConversationStore } from "./conversation-store";
import { assertUidSegment, type ConversationStore, type RawConversationDoc } from "./conversation-store-types";
import { decryptForClassification as decryptForClassificationWithKey, probeKey as probeKeyOnce } from "./content-codec";
import { classifyOwnerDocument, type OwnerReadCodec } from "./owner-read";
import { requestScopedTeamReader } from "./request-scoped-team-reader";
import { authorizeBoundParticipant, createFirestoreSharedTeamReader, type SharedTeamReader } from "./shared-team-binding";

/**
 * The caller's own participations, bounded and verified (SPEC BR-14, BR-21, BR-34, BR-36, BR-44, BR-53, D2-SI-12,
 * D2-SI-13; TASK-021, A2.1). The participant half of the list response.
 *
 * Each index entry is verified before it is shown. Every entry needs the canonical plain shape and the caller's named
 * participation, and the shared-team binding (`authorizeBoundParticipant`) must hold. A pending entry is shown with
 * `title: null` and is never decrypted. An accepted entry also needs the full BR-21 decision (`authorizeParticipant`), and
 * its title is taken from the decrypted payload. Entries that fail a check are omitted with no placeholder, and the omitted
 * count is never returned (BR-34).
 *
 * The key is probed at most once, and only when an authorized accepted entry needs decryption (BR-53). A key outage or a
 * key mismatch fails the whole list as `persistence_failed`, and is never an omission. A failed operational read is also
 * `persistence_failed`. Team and membership reads are shared within the request, so each is read once (BR-36).
 */

export interface ReadParticipationsDeps {
  store: ConversationStore;
  codec: OwnerReadCodec;
  teamReader: SharedTeamReader;
}

/** The participant summary (BR-44). Keys are exactly `PARTICIPANT_SUMMARY_KEYS`. No uid, memberRef or crypto detail. */
export interface ParticipationSummaryDto {
  conversationId: string;
  state: "pending" | "accepted";
  /** `null` while pending (BR-44). */
  title: string | null;
  invitedAt: Date;
}

export type ReadParticipationsResult =
  | { ok: true; participations: ParticipationSummaryDto[]; truncated: boolean }
  | { ok: false; error: "persistence_failed" };

const FAILED: ReadParticipationsResult = { ok: false, error: "persistence_failed" };

/** Per-entry outcome. `omit` is a failed check, `fail` is an operational failure that fails the whole list. */
type EntryOutcome = { kind: "show"; dto: ParticipationSummaryDto } | { kind: "omit" } | { kind: "fail" };
const OMIT: EntryOutcome = { kind: "omit" };
const FAIL: EntryOutcome = { kind: "fail" };

function isUidSegment(uid: string): boolean {
  try {
    assertUidSegment(uid);
    return true;
  } catch {
    return false;
  }
}

function defaultDeps(): ReadParticipationsDeps {
  return {
    store: getDefaultConversationStore(),
    codec: { probeKey: probeKeyOnce, decryptForClassification: decryptForClassificationWithKey },
    teamReader: createFirestoreSharedTeamReader(),
  };
}

/** The key is probed once per request, on the first accepted entry that needs decryption (BR-53). */
function oncePerRequest(probe: () => { ok: boolean }): () => boolean {
  let verdict: boolean | null = null;
  return () => {
    if (verdict === null) verdict = probe().ok;
    return verdict;
  };
}

async function summarizeEntry(
  callerUid: string,
  doc: RawConversationDoc,
  deps: ReadParticipationsDeps,
  reads: { teamReader: SharedTeamReader; keyAvailable: () => boolean },
): Promise<EntryOutcome> {
  // BR-34: a malformed index entry or a malformed conversation id is omitted, and nothing about it is revealed.
  if (!isConversationId(doc.id)) return OMIT;
  const index = parseStoredParticipationIndex(doc.data);
  if (!index.ok || !isUidSegment(index.entry.ownerUid)) return OMIT;
  const ownerUid = index.entry.ownerUid;
  const conversationId = doc.id;

  // BR-21 (b): the owner document must exist and have a valid plain shape. Nothing is decrypted here.
  const rawOwner = await deps.store.getOwner(ownerUid, conversationId);
  if (rawOwner === undefined) return OMIT;
  const shape = classifyStoredShape(rawOwner);
  if (shape.kind !== "valid") return OMIT;

  // BR-21 (c): the owner document must name this caller.
  const participant = shape.record.participant;
  if (participant === null || participant.uid !== callerUid) return OMIT;

  // BR-21 (d) and (e): a shared active team and the bound membership instance. An operational failure fails the list.
  const binding = await authorizeBoundParticipant(ownerUid, callerUid, participant.bindings, reads.teamReader);
  if (!binding.ok) return binding.error === "read_failed" ? FAIL : OMIT;

  const invitedAt = new Date(index.entry.invitedAt.getTime());
  if (participant.state === "pending") {
    // BR-14: the pending view needs the same binding, but no decryption and no key.
    return { kind: "show", dto: { conversationId, state: "pending", title: null, invitedAt } };
  }

  // BR-21 (a) to (e): the single access decision for content. Every denial is an omission.
  const decision = authorizeParticipant({ callerUid, index: doc.data, owner: rawOwner, binding });
  if (!decision.allowed) return OMIT;

  // BR-53: the key is probed once per request, only now that an authorized entry needs its title.
  if (!reads.keyAvailable()) return FAIL;
  // A key failure throws out of the classifier and is caught by the caller as `persistence_failed`. Malformed or
  // unauthenticated content is an omission for this entry, never a whole-list failure.
  const classification = classifyOwnerDocument(rawOwner, deps.codec, { ownerUid, conversationId });
  if (classification.kind !== "valid") return OMIT;

  return { kind: "show", dto: { conversationId, state: "accepted", title: classification.record.content.title, invitedAt } };
}

export async function readParticipations(
  callerUid: string,
  deps: ReadParticipationsDeps = defaultDeps(),
): Promise<ReadParticipationsResult> {
  try {
    // BR-34, BR-36: one bounded query. `truncated` is set from the raw count, and only the window is processed.
    const window = await deps.store.listParticipationWindow(callerUid);
    const truncated = window.rawCount > READ_WINDOW;
    const docs = window.docs.slice(0, READ_WINDOW);

    const reads = {
      teamReader: requestScopedTeamReader(deps.teamReader),
      keyAvailable: oncePerRequest(() => deps.codec.probeKey()),
    };

    const participations: ParticipationSummaryDto[] = [];
    for (const doc of docs) {
      const outcome = await summarizeEntry(callerUid, doc, deps, reads);
      if (outcome.kind === "fail") return FAILED;
      if (outcome.kind === "show") participations.push(outcome.dto);
    }

    return { ok: true, participations, truncated };
  } catch {
    // Any read, key or classification failure is operational for the whole list (BR-47, BR-53). It is never an omission.
    return FAILED;
  }
}

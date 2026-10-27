import { describe, expect, it } from "vitest";
import type { ConversationStore, ConversationTransaction, RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import type { FakeTeamEligibilityState } from "./fake-team-eligibility";
import { acceptInvitation, leaveParticipation, type RespondToParticipationDeps } from "./respond-to-participation";
import {
  NOW,
  OTHER_OWNER_UID,
  OWNER_UID,
  PARTICIPANT_MEMBER_REF,
  PARTICIPANT_UID,
  TEAM_ID,
  rosterTeam,
  seedOwnerConversation,
} from "./owner-read-test-support";
import type { DecryptOutcome, StoredEnvelope } from "../domain/stored-owner-conversation";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import { ContentKeyError } from "./content-codec";

/** Synthetic fixtures only (invariant 15). No real person, team or wellbeing data. */
const CONVERSATION_ID = "conv-1";
const SNAPSHOT_GOAL: SharedGoalSnapshot = {
  goalTitle: "Synthetic goal",
  treeId: "tree-a",
  targetDate: "2026-12-31",
  status: "active",
  capturedAt: new Date("2026-10-01T08:00:00.000Z"),
};
const OTHER_PARTICIPANT_UID = "participant-2";
const OTHER_MEMBER_REF = "abcdefghjkmnpqrstvwxyz0123";
const PARTICIPANT_NOTE = "Synthetic participant note";
const LATER = new Date(NOW.getTime() + 60_000);

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  state: FakeTeamEligibilityState;
  deps: RespondToParticipationDeps;
}

function setup(state: FakeTeamEligibilityState = rosterTeam([OWNER_UID, PARTICIPANT_UID])): Setup {
  // The store's transaction and the operation share one team fixture, as production shares one Firestore database (BR-48).
  const store = createFakeConversationStore({ teams: state });
  const codec = createFakeContentCodec();
  const deps: RespondToParticipationDeps = {
    store,
    codec,
    clock: () => new Date(LATER.getTime()),
  };
  return { store, codec, state, deps };
}

async function seedIndex(store: ConversationStore, callerUid: string, ownerUid: string): Promise<void> {
  await store.runTransaction(async (tx) => {
    tx.setParticipation(callerUid, CONVERSATION_ID, { ownerUid, invitedAt: NOW });
  });
}

/** A pending invitation to the participant, with an index entry, as TASK-014 leaves it. */
async function seedPending(store: ConversationStore, codec: FakeContentCodec): Promise<void> {
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    participant: { uid: PARTICIPANT_UID, state: "pending" },
  });
  await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
}

/** An accepted participant with notes, as TASK-019 leaves it. */
async function seedAccepted(
  store: ConversationStore,
  codec: FakeContentCodec,
  options: { status?: "open" | "completed" } = {},
): Promise<void> {
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    status: options.status,
    participant: { uid: PARTICIPANT_UID, state: "accepted" },
    participantNotes: PARTICIPANT_NOTE,
    ownerNotes: "Synthetic owner note",
  });
  await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
}

async function rawOwner(store: ConversationStore, ownerUid = OWNER_UID): Promise<RawConversationData | undefined> {
  return store.getOwner(ownerUid, CONVERSATION_ID);
}

async function rawIndex(store: ConversationStore, callerUid = PARTICIPANT_UID): Promise<RawConversationData | undefined> {
  return store.getParticipation(callerUid, CONVERSATION_ID);
}

/** Owner and index documents together, so a test can prove that a refused call wrote nothing. */
async function stateOf(store: ConversationStore) {
  return {
    owner: await rawOwner(store),
    ownerOfOther: await rawOwner(store, OTHER_OWNER_UID),
    index: await rawIndex(store),
    otherIndex: await rawIndex(store, OTHER_PARTICIPANT_UID),
  };
}

/** The decrypted content, read the way a decrypting reader reads it. */
async function storedContent(store: ConversationStore, codec: FakeContentCodec) {
  const raw = await rawOwner(store);
  if (raw === undefined) throw new Error("fixture document missing");
  const envelope = {
    ciphertext: raw.ciphertext,
    iv: raw.iv,
    authTag: raw.authTag,
    keyVersion: raw.keyVersion,
    keyCheck: raw.keyCheck,
  } as StoredEnvelope;
  const decoded = codec.decodeContent(envelope);
  if (!decoded.ok) throw new Error("fixture content unreadable");
  return decoded.content;
}

/** A store whose transaction fails on the index delete, after the owner update was buffered. */
function failingIndexDeleteStore(store: FakeConversationStore): ConversationStore {
  return {
    ...store,
    runTransaction: <T>(work: (tx: ConversationTransaction) => Promise<T>) =>
      store.runTransaction<T>((tx) =>
        work({
          ...tx,
          deleteParticipation() {
            throw new Error("injected failure");
          },
        }),
      ),
  };
}

/** A codec whose authenticated decrypt returns a fixed outcome, to exercise malformed or unreadable payloads. */
function codecWithDecryptOutcome(base: FakeContentCodec, outcome: DecryptOutcome): FakeContentCodec {
  return { ...base, decryptForClassification: () => outcome };
}

/** Canonical no-participant state: every participant field is null (TASK-002). */
const CLEARED = {
  participantUid: null,
  participantMemberRef: null,
  participantState: null,
  participantInvitedAt: null,
  participantAcceptedAt: null,
};
const DECLINE_OWNER_FIELDS = CLEARED;

const ENVELOPE_KEYS = ["ciphertext", "iv", "authTag", "keyVersion", "keyCheck"] as const;

/** The stored encrypted envelope, so a test can prove the payload is byte-identical. */
function envelopeOf(raw: RawConversationData | undefined): Record<string, unknown> {
  return Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, raw?.[key]]));
}

/** Counts calls to each codec operation, so a test can prove that a path never touches the key. */
function spyCodec(base: FakeContentCodec): { codec: FakeContentCodec; calls: { probe: number; decrypt: number; encode: number } } {
  const calls = { probe: 0, decrypt: 0, encode: 0 };
  const codec: FakeContentCodec = {
    probeKey() {
      calls.probe += 1;
      return base.probeKey();
    },
    encodeContent(content) {
      calls.encode += 1;
      return base.encodeContent(content);
    },
    decodeContent: (envelope) => base.decodeContent(envelope),
    decryptForClassification(envelope) {
      calls.decrypt += 1;
      return base.decryptForClassification(envelope);
    },
    setKeyFailure: (failure) => base.setKeyFailure(failure),
  };
  return { codec, calls };
}

/** A store whose transactions run `work` through `decorate`, so one write can be made to fail. */
function withTransaction(store: FakeConversationStore, decorate: (tx: ConversationTransaction) => ConversationTransaction): ConversationStore {
  return {
    ...store,
    runTransaction: <T>(work: (tx: ConversationTransaction) => Promise<T>) => store.runTransaction<T>((tx) => work(decorate(tx))),
  };
}

describe("acceptInvitation: BR-15 re-checks in the transaction", () => {
  it("moves a pending invitation to accepted and sets the accepted time", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    const before = await rawOwner(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    const after = await rawOwner(store);
    expect(after?.participantState).toBe("accepted");
    expect(after?.participantAcceptedAt).toEqual(LATER);
    // Plain fields only: the payload, the bound uid and memberRef, and the invitation time are unchanged.
    expect(after?.ciphertext).toBe(before?.ciphertext);
    expect(after?.participantUid).toBe(PARTICIPANT_UID);
    expect(after?.participantMemberRef).toBe(PARTICIPANT_MEMBER_REF);
    expect(after?.participantInvitedAt).toEqual(before?.participantInvitedAt);
  });

  it("refuses a caller with no index entry as conversation_not_found, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    await store.runTransaction(async (tx) => tx.deleteParticipation(PARTICIPANT_UID, CONVERSATION_ID));
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a stale index whose owner document names another participant, with no write", async () => {
    const { store, codec, deps } = setup(rosterTeam([OWNER_UID, PARTICIPANT_UID, OTHER_PARTICIPANT_UID]));
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      participant: { uid: OTHER_PARTICIPANT_UID, state: "pending" },
    });
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses an invitation that is not pending, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a caller who is no longer an active member, with no write", async () => {
    const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
    const { store, codec, deps } = setup(state);
    await seedPending(store, codec);
    delete state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a caller whose team is disabled, with no write", async () => {
    const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
    const { store, codec, deps } = setup(state);
    await seedPending(store, codec);
    state.teamStatus[TEAM_ID] = "disabled";
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a memberRef that no longer matches the caller's current membership, with no write", async () => {
    const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
    const { store, codec, deps } = setup(state);
    await seedPending(store, codec);
    state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = {
      uid: PARTICIPANT_UID,
      teamId: TEAM_ID,
      createdAt: new Date(0),
      memberRef: OTHER_MEMBER_REF,
    };
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses when the owner document is missing, with no write", async () => {
    const { store, deps } = setup();
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("reports a membership read failure as persistence_failed, with no write", async () => {
    const state = { ...rosterTeam([OWNER_UID, PARTICIPANT_UID]), failMembershipRead: true };
    const { store, codec, deps } = setup(state);
    await seedPending(store, codec);
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("accepts during a key outage, because it writes plain fields only", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    codec.setKeyFailure("key_unavailable");

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });
    expect((await rawOwner(store))?.participantState).toBe("accepted");
  });
});

describe("leaveParticipation: decline and leave share one path (BR-17, IMPL-1)", () => {
  it("declines a pending invitation: clears the participant fields and deletes the index", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    expect(await rawIndex(store)).toBeUndefined();
    expect(await rawOwner(store)).toMatchObject({ ...DECLINE_OWNER_FIELDS, status: "open" });
  });

  it("removes participant notes and clears the owner's participant fields when an accepted participant leaves an open conversation", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    expect(await rawIndex(store)).toBeUndefined();
    expect(await rawOwner(store)).toMatchObject(DECLINE_OWNER_FIELDS);
    const content = await storedContent(store, codec);
    expect(content.participantNotes).toBe("");
    // The owner's own content is untouched (BR-16 effects, owner content unchanged).
    expect(content.ownerNotes).toBe("Synthetic owner note");
  });

  it("allows an accepted participant to leave a completed conversation with the same effects", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec, { status: "completed" });

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    expect(await rawIndex(store)).toBeUndefined();
    expect(await rawOwner(store)).toMatchObject({ ...DECLINE_OWNER_FIELDS, status: "completed" });
    expect((await storedContent(store, codec)).participantNotes).toBe("");
  });

  it("allows an accepted participant to leave while ineligible, and removes the notes", async () => {
    const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
    const { store, codec, deps } = setup(state);
    await seedAccepted(store, codec);
    state.teamStatus[TEAM_ID] = "disabled";
    delete state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    expect(await rawIndex(store)).toBeUndefined();
    expect(await rawOwner(store)).toMatchObject(DECLINE_OWNER_FIELDS);
    expect((await storedContent(store, codec)).participantNotes).toBe("");
  });

  it("writes the owner document and the index in one transaction: a failed index delete leaves both unchanged", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    const before = await stateOf(store);

    const result = await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ...deps, store: failingIndexDeleteStore(store) });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(await stateOf(store)).toEqual(before);
    expect((await storedContent(store, codec)).participantNotes).toBe(PARTICIPANT_NOTE);
  });

  it("deletes a stale index when the owner document names another participant, and changes no owner data", async () => {
    const { store, codec, deps } = setup(rosterTeam([OWNER_UID, PARTICIPANT_UID, OTHER_PARTICIPANT_UID]));
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      participant: { uid: OTHER_PARTICIPANT_UID, state: "accepted" },
      participantNotes: PARTICIPANT_NOTE,
    });
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
    const ownerBefore = await rawOwner(store);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    expect(await rawIndex(store)).toBeUndefined();
    expect(await rawOwner(store)).toEqual(ownerBefore);
    expect((await storedContent(store, codec)).participantNotes).toBe(PARTICIPANT_NOTE);
  });

  it("deletes a stale index when the owner document is missing", async () => {
    const { store, deps } = setup();
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });
    expect(await rawIndex(store)).toBeUndefined();
  });

  it("refuses a caller with no index entry as conversation_not_found, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    await store.runTransaction(async (tx) => tx.deleteParticipation(PARTICIPANT_UID, CONVERSATION_ID));
    const before = await stateOf(store);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a leave under key outage as persistence_failed, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    codec.setKeyFailure("key_unavailable");
    const before = await stateOf(store);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a malformed decrypted payload as conversation_not_found, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    const before = await stateOf(store);
    const malformed = { ...deps, codec: codecWithDecryptOutcome(codec, { status: "decrypted", payload: { unexpected: true } }) };

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, malformed)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses an unauthenticated payload as conversation_not_found, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    const before = await stateOf(store);
    const tampered = { ...deps, codec: codecWithDecryptOutcome(codec, { status: "authentication_failed" }) };

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, tampered)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a key mismatch as persistence_failed, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    const before = await stateOf(store);
    const mismatch = {
      ...deps,
      codec: {
        ...codec,
        decryptForClassification: () => {
          throw new ContentKeyError("key_mismatch");
        },
      },
    };

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, mismatch)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("keeps title, ownerNotes, nextSteps and sharedGoals when the notes are removed", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      title: "Synthetic title",
      ownerNotes: "Synthetic owner note",
      nextSteps: ["Synthetic step"],
      sharedGoals: [SNAPSHOT_GOAL],
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
      participantNotes: PARTICIPANT_NOTE,
    });
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    expect(await storedContent(store, codec)).toEqual({
      title: "Synthetic title",
      ownerNotes: "Synthetic owner note",
      nextSteps: ["Synthetic step"],
      participantNotes: "",
      sharedGoals: [SNAPSHOT_GOAL],
    });
  });

  it("writes nothing when the encrypted replacement cannot be produced", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    const before = await stateOf(store);
    const noEncode = { ...deps, codec: { ...codec, encodeContent: () => ({ ok: false as const, error: "key_unavailable" as const }) } };

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, noEncode)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("rolls back the owner and index when the owner update fails", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    const before = await stateOf(store);

    const result = await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, {
      ...deps,
      store: withTransaction(store, (tx) => ({
        ...tx,
        updateOwner() {
          throw new Error("injected failure");
        },
      })),
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a transaction failure as persistence_failed, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    const before = await stateOf(store);
    const broken: ConversationStore = {
      ...store,
      runTransaction: async () => {
        throw new Error("injected failure");
      },
    };

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ...deps, store: broken })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a malformed owner document that names the caller, with no write", async () => {
    const { store, deps } = setup();
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { participantUid: PARTICIPANT_UID, title: "Synthetic" });
    const before = await stateOf(store);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a completed conversation that still names a pending participant, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      status: "completed",
      participant: { uid: PARTICIPANT_UID, state: "pending" },
    });
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
    const before = await stateOf(store);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("leaves a stale index for another participant's invitation untouched", async () => {
    const { store, codec, deps } = setup(rosterTeam([OWNER_UID, PARTICIPANT_UID, OTHER_PARTICIPANT_UID]));
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      participant: { uid: OTHER_PARTICIPANT_UID, state: "pending" },
    });
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
    await seedIndex(store, OTHER_PARTICIPANT_UID, OWNER_UID);
    const ownerBefore = await rawOwner(store);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    expect(await rawIndex(store)).toBeUndefined();
    expect(await rawIndex(store, OTHER_PARTICIPANT_UID)).toBeDefined();
    expect(await rawOwner(store)).toEqual(ownerBefore);
  });
});

describe("leaveParticipation: pending decline does not touch the key or the payload (locked IMPL-1 reconciliation)", () => {
  it("declines during a key outage with no probe, no decryption and no re-encryption", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    const envelopeBefore = envelopeOf(await rawOwner(store));
    const spy = spyCodec(codec);
    codec.setKeyFailure("key_unavailable");

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ...deps, codec: spy.codec })).toEqual({ ok: true });

    expect(spy.calls).toEqual({ probe: 0, decrypt: 0, encode: 0 });
    expect(envelopeOf(await rawOwner(store))).toEqual(envelopeBefore);
    expect(await rawIndex(store)).toBeUndefined();
  });

  it("clears the binding canonically, keeps the invitation's owner fields, and advances updatedAt", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    const before = await rawOwner(store);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    const after = await rawOwner(store);
    expect(after).toMatchObject({ ...CLEARED, updatedAt: LATER });
    expect(after?.teamId).toBe(before?.teamId);
    expect(after?.plannedFor).toBe(before?.plannedFor);
    expect(after?.status).toBe(before?.status);
    expect(after?.createdAt).toEqual(before?.createdAt);
  });

  it("lets a caller decline after losing eligibility, because decline is access-ending and eligibility-free", async () => {
    const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
    const { store, codec, deps } = setup(state);
    await seedPending(store, codec);
    state.teamStatus[TEAM_ID] = "disabled";
    delete state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });
    expect(await rawIndex(store)).toBeUndefined();
  });

  it("rolls back the owner update and the index delete together when the index delete fails", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    const before = await stateOf(store);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ...deps, store: failingIndexDeleteStore(store) })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a completed pending state as conversation_not_found, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      status: "completed",
      participant: { uid: PARTICIPANT_UID, state: "pending" },
    });
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
    const before = await stateOf(store);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });
});

describe("acceptInvitation: envelope, probe and timestamps", () => {
  it("keeps the envelope byte-identical, probes and decrypts nothing, and advances only updatedAt and the accepted fields", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    const before = await rawOwner(store);
    const spy = spyCodec(codec);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, { ...deps, codec: spy.codec })).toEqual({ ok: true });

    expect(spy.calls).toEqual({ probe: 0, decrypt: 0, encode: 0 });
    const after = await rawOwner(store);
    expect(envelopeOf(after)).toEqual(envelopeOf(before));
    expect(after).toEqual({ ...before, participantState: "accepted", participantAcceptedAt: LATER, updatedAt: LATER });
  });

  it("refuses a malformed owner document, with no write", async () => {
    const { store, deps } = setup();
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { participantUid: PARTICIPANT_UID, participantState: "pending" });
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a malformed index entry, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: 42, invitedAt: "not a date" });
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses a completed conversation with a pending participant, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      status: "completed",
      participant: { uid: PARTICIPANT_UID, state: "pending" },
    });
    await seedIndex(store, PARTICIPANT_UID, OWNER_UID);
    const before = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("rolls back when the transaction fails, and reports persistence_failed", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    const before = await stateOf(store);

    const result = await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, {
      ...deps,
      store: withTransaction(store, (tx) => ({
        ...tx,
        updateOwner() {
          throw new Error("injected failure");
        },
      })),
    });

    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(await stateOf(store)).toEqual(before);
  });
});

/** Counts each transaction attempt and the team and membership reads inside it. Wraps the transaction; changes nothing. */
function countAcceptReads(store: FakeConversationStore): { store: ConversationStore; counts: { attempts: number; team: number; membership: number } } {
  const counts = { attempts: 0, team: 0, membership: 0 };
  const observed: ConversationStore = {
    ...store,
    runTransaction: <T>(work: (tx: ConversationTransaction) => Promise<T>) =>
      store.runTransaction<T>((tx) => {
        counts.attempts += 1;
        return work({
          ...tx,
          teamEligibility: {
            getTeamStatus: (teamId) => {
              counts.team += 1;
              return tx.teamEligibility.getTeamStatus(teamId);
            },
            getMembership: (uid, teamId) => {
              counts.membership += 1;
              return tx.teamEligibility.getMembership(uid, teamId);
            },
          },
        });
      }),
  };
  return { store: observed, counts };
}

describe("acceptInvitation: BR-48 transaction-backed eligibility and retry (TASK-016 correction)", () => {
  it("reads team and membership through the transaction on the accepting attempt", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    const counted = countAcceptReads(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, { ...deps, store: counted.store })).toEqual({ ok: true });
    expect(counted.counts).toEqual({ attempts: 1, team: 1, membership: 1 });
  });

  it("retry: membership removed after the first attempt → denied, and the participant is not accepted", async () => {
    const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
    const { store, codec, deps } = setup(state);
    await seedPending(store, codec);
    const before = await stateOf(store);
    store.scheduleCommitConflicts(1, () => {
      delete state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];
    });
    const counted = countAcceptReads(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, { ...deps, store: counted.store })).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(counted.counts.attempts).toBe(2);
    expect(await stateOf(store)).toEqual(before);
    expect((await rawOwner(store))?.participantState).toBe("pending");
  });

  it("retry: membership removed and rejoined with a new memberRef → denied, and the participant is not accepted", async () => {
    const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
    const { store, codec, deps } = setup(state);
    await seedPending(store, codec);
    const before = await stateOf(store);
    store.scheduleCommitConflicts(1, () => {
      state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = {
        uid: PARTICIPANT_UID,
        teamId: TEAM_ID,
        createdAt: new Date(LATER.getTime()),
        memberRef: OTHER_MEMBER_REF,
      };
    });

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, { ...deps })).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
    expect((await rawOwner(store))?.participantState).toBe("pending");
  });

  it("retry: team disabled after the first attempt → denied, and the participant is not accepted", async () => {
    const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
    const { store, codec, deps } = setup(state);
    await seedPending(store, codec);
    const before = await stateOf(store);
    store.scheduleCommitConflicts(1, () => {
      state.teamStatus[TEAM_ID] = "disabled";
    });

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
    expect((await rawOwner(store))?.participantState).toBe("pending");
  });

  it("every retry re-reads team and membership, and an eligible retry accepts once", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    store.scheduleCommitConflicts(2);
    const counted = countAcceptReads(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, { ...deps, store: counted.store })).toEqual({ ok: true });
    expect(counted.counts).toEqual({ attempts: 3, team: 3, membership: 3 });
    expect((await rawOwner(store))?.participantState).toBe("accepted");
  });

  it("a transaction-bound team read failure → persistence_failed, with no accept mutation", async () => {
    const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
    const { store, codec, deps } = setup(state);
    await seedPending(store, codec);
    const before = await stateOf(store);
    state.failTeamRead = true;

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("a transaction-bound membership read failure → persistence_failed, with no accept mutation", async () => {
    const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
    const { store, codec, deps } = setup(state);
    await seedPending(store, codec);
    const before = await stateOf(store);
    state.failMembershipRead = true;

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("accept during a key outage succeeds, with zero key probe and zero decrypt", async () => {
    const { store, codec, deps } = setup();
    await seedPending(store, codec);
    codec.setKeyFailure("key_unavailable");
    let probes = 0;
    let decrypts = 0;
    const counted = {
      ...codec,
      probeKey: () => {
        probes += 1;
        return codec.probeKey();
      },
      decryptForClassification: (envelope: StoredEnvelope): DecryptOutcome => {
        decrypts += 1;
        return codec.decryptForClassification(envelope);
      },
    };

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, { ...deps, codec: counted })).toEqual({ ok: true });
    codec.setKeyFailure(null);
    expect({ probes, decrypts }).toEqual({ probes: 0, decrypts: 0 });
    expect((await rawOwner(store))?.participantState).toBe("accepted");
  });
});

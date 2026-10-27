import { describe, expect, it } from "vitest";
import { completeConversation, type CompleteConversationDeps } from "./complete-conversation";
import type { ConversationStore, ConversationTransaction, RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { type FakeTeamEligibilityState, createFakeTeamEligibilityReader } from "./fake-team-eligibility";
import { OWNER_UID, OTHER_OWNER_UID, PARTICIPANT_UID, TEAM_ID, NOW, rosterTeam, seedOwnerConversation } from "./owner-read-test-support";
import { changeParticipant } from "./change-participant";
import { deleteConversation } from "./delete-conversation";
import { setSharedGoals } from "./set-shared-goals";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import { acceptInvitation, leaveParticipation } from "./respond-to-participation";
import { writeParticipantNotes } from "./write-participant-notes";
import type { StoredEnvelope } from "../domain/stored-owner-conversation";

// Synthetic fixtures only (invariant 15). No real person, team or wellbeing data.
const CONVERSATION_ID = "conv-1";
const LATER = new Date(NOW.getTime() + 60_000);
const PARTICIPANT_NOTE = "Synthetic participant note";
const OWNER_NOTE = "Synthetic owner note";
const SNAPSHOT: SharedGoalSnapshot = {
  goalTitle: "Synthetic goal",
  treeId: null,
  targetDate: null,
  status: "active",
  capturedAt: NOW,
};

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  state: FakeTeamEligibilityState;
  deps: CompleteConversationDeps;
}

function setup(): Setup {
  const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
  const store = createFakeConversationStore({ teams: state });
  const codec = createFakeContentCodec();
  const deps: CompleteConversationDeps = { store, clock: () => new Date(LATER.getTime()) };
  return { store, codec, state, deps };
}

async function seed(
  setupValue: Setup,
  participant: "none" | "pending" | "accepted" = "none",
  options: { sharedGoals?: SharedGoalSnapshot[] } = {},
): Promise<void> {
  const { store, codec } = setupValue;
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    ownerNotes: OWNER_NOTE,
    nextSteps: ["Synthetic step"],
    participantNotes: participant === "accepted" ? PARTICIPANT_NOTE : "",
    sharedGoals: options.sharedGoals,
    participant: participant === "none" ? undefined : { uid: PARTICIPANT_UID, state: participant },
  });
  if (participant !== "none") {
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: NOW });
  }
}

async function ownerOf(store: ConversationStore, ownerUid = OWNER_UID): Promise<RawConversationData> {
  const raw = await store.getOwner(ownerUid, CONVERSATION_ID);
  if (raw === undefined) throw new Error("fixture document missing");
  return raw;
}

async function indexOf(store: ConversationStore, callerUid = PARTICIPANT_UID): Promise<RawConversationData | undefined> {
  return store.getParticipation(callerUid, CONVERSATION_ID);
}

/** Owner and index documents together, so a test can prove that a refused or failed call changed nothing. */
async function stateOf(store: ConversationStore) {
  return { owner: await store.getOwner(OWNER_UID, CONVERSATION_ID), index: await indexOf(store) };
}

/** The decrypted content, read through the synthetic codec only to assert on it. */
function contentOf(codec: FakeContentCodec, raw: RawConversationData) {
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

/** The envelope fields, which completion must never rewrite. */
function envelopeOf(raw: RawConversationData) {
  return { ciphertext: raw.ciphertext, iv: raw.iv, authTag: raw.authTag, keyVersion: raw.keyVersion, keyCheck: raw.keyCheck };
}

/** A store whose transactions run `work` through `decorate`, so one write inside the completion can be made to fail. */
function decoratedStore(store: FakeConversationStore, decorate: (tx: ConversationTransaction) => ConversationTransaction): ConversationStore {
  return {
    ...store,
    runTransaction: <T>(work: (tx: ConversationTransaction) => Promise<T>) => store.runTransaction<T>((tx) => work(decorate(tx))),
  };
}

describe("completeConversation: lifecycle (BR-4, BR-28)", () => {
  it("completes an open conversation with no participant: status, completedAt and updatedAt; everything else unchanged", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seed(setupValue);
    const before = await ownerOf(store);

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    const after = await ownerOf(store);
    expect(after.status).toBe("completed");
    expect(after.completedAt).toEqual(LATER);
    expect(after.updatedAt).toEqual(LATER);
    expect(envelopeOf(after)).toEqual(envelopeOf(before));
    for (const key of ["teamId", "plannedFor", "createdAt", "participantUid", "participantState"] as const) {
      expect(after[key], key).toEqual(before[key]);
    }
  });

  it("withdraws a pending invitation in the same commit: participant fields cleared, index deleted, payload untouched", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seed(setupValue, "pending");
    const before = await ownerOf(store);

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    const after = await ownerOf(store);
    expect(after.status).toBe("completed");
    expect(after.participantUid).toBeNull();
    expect(after.participantMemberRef).toBeNull();
    expect(after.participantState).toBeNull();
    expect(after.participantInvitedAt).toBeNull();
    expect(after.participantAcceptedAt).toBeNull();
    expect(await indexOf(store)).toBeUndefined();
    expect(envelopeOf(after)).toEqual(envelopeOf(before));
  });

  it("keeps an accepted participant and their notes: participant fields and index unchanged, payload unchanged", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seed(setupValue, "accepted");
    const before = await ownerOf(store);
    const indexBefore = await indexOf(store);

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    const after = await ownerOf(store);
    expect(after.status).toBe("completed");
    expect(after.participantUid).toBe(PARTICIPANT_UID);
    expect(after.participantState).toBe("accepted");
    expect(after.participantAcceptedAt).toEqual(before.participantAcceptedAt);
    expect(await indexOf(store)).toEqual(indexBefore);
    expect(contentOf(codec, after).participantNotes).toBe(PARTICIPANT_NOTE);
    expect(envelopeOf(after)).toEqual(envelopeOf(before));
  });

  it("completing an already completed conversation returns invalid_transition, with no write", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seed(setupValue);
    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });
    const before = await stateOf(store);

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "invalid_transition" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("returns conversation_not_found for an unknown or malformed id, and for another owner, with no write", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seed(setupValue);
    const before = await stateOf(store);

    expect(await completeConversation(OWNER_UID, "no-such-conversation", deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await completeConversation(OWNER_UID, "bad.id", deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await completeConversation(OTHER_OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("returns conversation_not_found for a malformed owner document, with no write", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { title: "not a canonical document" });
    const before = await stateOf(store);

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await stateOf(store)).toEqual(before);
  });

  it("completes during a key outage, because completion never reads the payload (IMPL-1)", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seed(setupValue, "accepted");
    const before = await ownerOf(store);
    codec.setKeyFailure("key_unavailable");

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });
    codec.setKeyFailure(null);

    const after = await ownerOf(store);
    expect(after.status).toBe("completed");
    expect(envelopeOf(after)).toEqual(envelopeOf(before));
  });

  it("does not depend on team or membership state: a disabled team still allows completion", async () => {
    const setupValue = setup();
    const { store, state, deps } = setupValue;
    await seed(setupValue, "accepted");
    state.teamStatus[TEAM_ID] = "disabled";

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });
    expect((await ownerOf(store)).status).toBe("completed");
  });
});

describe("completeConversation: atomicity and retry (BR-48)", () => {
  it("an injected index-delete failure leaves the owner document and the index unchanged", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seed(setupValue, "pending");
    const before = await stateOf(store);
    const failingDelete = decoratedStore(store, (tx) => ({
      ...tx,
      deleteParticipation: () => {
        throw new Error("simulated index delete failure");
      },
    }));

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, { ...deps, store: failingDelete })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await stateOf(store)).toEqual(before);
  });

  it("an injected owner-update failure leaves the index unchanged and the owner open", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seed(setupValue, "pending");
    const before = await stateOf(store);
    const failingUpdate = decoratedStore(store, (tx) => ({
      ...tx,
      updateOwner: () => {
        throw new Error("simulated owner update failure");
      },
    }));

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, { ...deps, store: failingUpdate })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await stateOf(store)).toEqual(before);
    expect((await ownerOf(store)).status).toBe("open");
  });

  it("a commit conflict reruns the completion, and the final state equals a single run", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seed(setupValue, "pending");
    store.scheduleCommitConflicts(1);

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    const after = await ownerOf(store);
    expect(after.status).toBe("completed");
    expect(after.completedAt).toEqual(LATER);
    expect(after.participantState).toBeNull();
    expect(await indexOf(store)).toBeUndefined();
  });
});

describe("completeConversation: remaining failure cases and commit order (BR-47, BR-48, BR-50 (1))", () => {
  it("a commit failure after the work ran → persistence_failed, and neither document changes", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seed(setupValue, "pending");
    const before = await stateOf(store);
    const failingCommit: ConversationStore = {
      ...store,
      runTransaction: <T>(work: (tx: ConversationTransaction) => Promise<T>) =>
        store.runTransaction<T>(async (tx) => {
          await work(tx);
          throw new Error("simulated commit failure");
        }),
    };

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, { ...deps, store: failingCommit })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await stateOf(store)).toEqual(before);
  });

  it("an owner read failure → persistence_failed, with no write and no index change", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seed(setupValue, "pending");
    const before = await stateOf(store);
    const failingRead = decoratedStore(store, (tx) => ({
      ...tx,
      getOwner: async () => {
        throw new Error("simulated owner read failure");
      },
    }));

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, { ...deps, store: failingRead })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await stateOf(store)).toEqual(before);
  });

  it("an accept that commits before completion keeps the accepted participant, index and state after completion", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seed(setupValue, "pending");
    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, { store, codec, clock: deps.clock })).toEqual({ ok: true });
    const indexBefore = await indexOf(store);

    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    const after = await ownerOf(store);
    expect(after.status).toBe("completed");
    expect(after.participantUid).toBe(PARTICIPANT_UID);
    expect(after.participantState).toBe("accepted");
    expect(await indexOf(store)).toEqual(indexBefore);
  });
});

describe("completeConversation: races are resolved by commit order (BR-50 (1), CL-25)", () => {
  it("an accept after completion of a pending invitation → conversation_not_found, and no access is created", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seed(setupValue, "pending");
    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });
    const afterCompletion = await stateOf(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, { store, codec, clock: deps.clock })).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await stateOf(store)).toEqual(afterCompletion);
    expect(await indexOf(store)).toBeUndefined();
    expect((await ownerOf(store)).participantState).toBeNull();
  });

  it("a participant notes write after completion of an accepted conversation → conversation_completed, content unchanged", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seed(setupValue, "accepted");
    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });
    const afterCompletion = await ownerOf(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "Late note", { store, codec, clock: deps.clock })).toEqual({
      ok: false,
      error: "conversation_completed",
    });
    const after = await ownerOf(store);
    expect(after).toEqual(afterCompletion);
    expect(contentOf(codec, after).participantNotes).toBe(PARTICIPANT_NOTE);
  });

  it("a participant notes write after completion of a withdrawn invitation → conversation_not_found", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seed(setupValue, "pending");
    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "Late note", { store, codec, clock: deps.clock })).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
  });
});

describe("completeConversation: completion freezes content, never access (D2-SI-9)", () => {
  it("the owner can still remove an accepted participant after completion, and the notes are deleted", async () => {
    const setupValue = setup();
    const { store, codec, state, deps } = setupValue;
    await seed(setupValue, "accepted");
    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });
    const refReader = { ...createFakeTeamEligibilityReader(state), listMemberships: async () => [] };

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, { store, codec, refReader, clock: deps.clock })).toEqual({
      ok: true,
    });

    const after = await ownerOf(store);
    expect(after.participantUid).toBeNull();
    expect(after.status).toBe("completed");
    expect(await indexOf(store)).toBeUndefined();
    expect(contentOf(codec, after).participantNotes).toBe("");
  });

  it("the participant can still leave after completion, and the notes are deleted", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seed(setupValue, "accepted");
    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, { store, codec, clock: deps.clock })).toEqual({ ok: true });

    const after = await ownerOf(store);
    expect(after.participantUid).toBeNull();
    expect(await indexOf(store)).toBeUndefined();
    expect(contentOf(codec, after).participantNotes).toBe("");
  });

  it("the owner can still clear the shared goals after completion", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seed(setupValue, "none", { sharedGoals: [SNAPSHOT] });
    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    const result = await setSharedGoals(OWNER_UID, CONVERSATION_ID, [], {
      store,
      codec,
      goalStore: { get: async () => undefined },
      clock: deps.clock,
    });

    expect(result).toEqual({ ok: true });
    expect(contentOf(codec, await ownerOf(store)).sharedGoals).toEqual([]);
  });

  it("the owner can still delete a completed conversation", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seed(setupValue, "accepted");
    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: true });

    expect(await deleteConversation(OWNER_UID, CONVERSATION_ID, { store })).toEqual({ ok: true });
    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toBeUndefined();
  });
});

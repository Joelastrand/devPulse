import { describe, expect, it } from "vitest";
import { NOTE_MAX_BYTES } from "../domain/conversation-constants";
import { changeParticipant } from "./change-participant";
import type { ConversationStore, ConversationTransaction, RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import {
  NOW,
  OWNER_UID,
  OTHER_OWNER_UID,
  PARTICIPANT_MEMBER_REF,
  PARTICIPANT_UID,
  TEAM_ID,
  seedOwnerConversation,
} from "./owner-read-test-support";
import { writeParticipantNotes, type WriteParticipantNotesDeps } from "./write-participant-notes";

// Synthetic fixtures only (invariant 15). No real person, team or wellbeing data.
const CONVERSATION_ID = "conv-1";
const LATER = new Date(NOW.getTime() + 60_000);
const PARTICIPANT_NOTE = "Synthetic participant note";
const OWNER_NOTE = "Synthetic owner note";

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  state: FakeTeamEligibilityState;
  deps: WriteParticipantNotesDeps;
}

function setup(): Setup {
  const codec = createFakeContentCodec();
  const state: FakeTeamEligibilityState = {
    teamStatus: { [TEAM_ID]: "active" },
    memberships: {
      [`${OWNER_UID}__${TEAM_ID}`]: { uid: OWNER_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: "0123456789abcdefghjkmnpqrs" },
      [`${PARTICIPANT_UID}__${TEAM_ID}`]: {
        uid: PARTICIPANT_UID,
        teamId: TEAM_ID,
        createdAt: new Date(0),
        memberRef: PARTICIPANT_MEMBER_REF,
      },
    },
  };
  // The store's transaction and the operation share one team fixture, as production shares one Firestore database.
  const store = createFakeConversationStore({ teams: state });
  const deps: WriteParticipantNotesDeps = {
    store,
    codec,
    clock: () => new Date(LATER.getTime()),
  };
  return { store, codec, state, deps };
}

async function seedAccepted(setupValue: Setup, status: "open" | "completed" = "open"): Promise<void> {
  await seedOwnerConversation(setupValue.store, setupValue.codec, {
    conversationId: CONVERSATION_ID,
    title: "Synthetic title",
    ownerNotes: OWNER_NOTE,
    nextSteps: ["Synthetic step"],
    plannedFor: "2026-11-03",
    participant: { uid: PARTICIPANT_UID, state: "accepted" },
    participantNotes: "",
    status,
  });
  setupValue.store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: NOW });
}

async function rawOwner(store: ConversationStore, ownerUid = OWNER_UID): Promise<RawConversationData> {
  const raw = await store.getOwner(ownerUid, CONVERSATION_ID);
  if (raw === undefined) throw new Error("fixture document missing");
  return raw;
}

/** The decrypted payload, read through the synthetic codec only to assert on it. */
function decoded(codec: FakeContentCodec, raw: RawConversationData) {
  const result = codec.decodeContent({
    ciphertext: raw.ciphertext as string,
    iv: raw.iv as string,
    authTag: raw.authTag as string,
    keyVersion: raw.keyVersion as string,
    keyCheck: raw.keyCheck as string,
  } as Parameters<FakeContentCodec["decodeContent"]>[0]);
  if (!result.ok) throw new Error("fixture payload does not decode");
  return result.content;
}

describe("writeParticipantNotes: accepted eligible participant (BR-20, D2-SI-7)", () => {
  it("replaces participantNotes and advances updatedAt", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({ ok: true });

    const after = await rawOwner(store);
    expect(decoded(codec, after).participantNotes).toBe(PARTICIPANT_NOTE);
    expect(after.updatedAt).toEqual(LATER);
  });

  it("is last write wins: a second write replaces the first", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);

    await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "First", deps);
    await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "Second", deps);

    expect(decoded(codec, await rawOwner(store)).participantNotes).toBe("Second");
  });

  it("clears the notes when the value is the empty string", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "", deps)).toEqual({ ok: true });

    expect(decoded(codec, await rawOwner(store)).participantNotes).toBe("");
  });

  it("preserves every owner section in the re-encoded payload", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);
    const beforeContent = decoded(codec, before);

    await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps);

    const after = await rawOwner(store);
    const afterContent = decoded(codec, after);
    expect(afterContent).toEqual({ ...beforeContent, participantNotes: PARTICIPANT_NOTE });
    for (const key of [
      "teamId",
      "plannedFor",
      "status",
      "completedAt",
      "createdAt",
      "participantUid",
      "participantMemberRef",
      "participantState",
      "participantInvitedAt",
      "participantAcceptedAt",
    ] as const) {
      expect(after[key], key).toEqual(before[key]);
    }
  });

  it("stores no plaintext note in the stored object", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue);

    await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps);

    expect(JSON.stringify(await rawOwner(store))).not.toContain(PARTICIPANT_NOTE);
  });
});

describe("writeParticipantNotes: input (BR-20, BR-40)", () => {
  it("refuses a value over NOTE_MAX_BYTES as invalid_input with the field name, before any write", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);

    const result = await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "x".repeat(NOTE_MAX_BYTES + 1), deps);

    expect(result).toEqual({ ok: false, error: "invalid_input", field: "notes" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses a non-string value as invalid_input", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, 42, deps)).toEqual({
      ok: false,
      error: "invalid_input",
      field: "notes",
    });
    expect(await rawOwner(store)).toEqual(before);
  });
});

describe("writeParticipantNotes: access (BR-21, D2-SI-2, D2-SI-15)", () => {
  it("returns conversation_not_found for the owner, who has no participant index", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(OWNER_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found for a pending participant", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      participant: { uid: PARTICIPANT_UID, state: "pending" },
    });
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: NOW });
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found for an accepted participant who is no longer eligible, with no write", async () => {
    const setupValue = setup();
    const { store, state, deps } = setupValue;
    await seedAccepted(setupValue);
    delete state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found for a caller whose index names another owner's document", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue);
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OTHER_OWNER_UID, invitedAt: NOW });
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });
});

describe("writeParticipantNotes: lifecycle and races (BR-28, BR-50 (1) and (2))", () => {
  it("returns conversation_completed after completion, with no write", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue, "completed");
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_completed",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found after removal, and does not recreate participantNotes", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps);
    const removal = await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, {
      store,
      codec,
      refReader: { ...createFakeTeamEligibilityReader(setupValue.state), listMemberships: async () => [] },
      clock: () => new Date(LATER.getTime()),
    });
    expect(removal).toEqual({ ok: true });
    const removed = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "Late note", deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });

    const after = await rawOwner(store);
    expect(after).toEqual(removed);
    expect(decoded(codec, after).participantNotes).toBe("");
  });
});

describe("writeParticipantNotes: key outage (BR-53, IMPL-1)", () => {
  it("returns persistence_failed on a key outage, with no write", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);
    codec.setKeyFailure("key_unavailable");

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    codec.setKeyFailure(null);
    expect(await rawOwner(store)).toEqual(before);
  });
});

describe("writeParticipantNotes: authorization before crypto and completion (privacy ordering)", () => {
  it("returns conversation_not_found, not persistence_failed, to a non-participant during a key outage", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    codec.setKeyFailure("key_unavailable");

    expect(await writeParticipantNotes(OWNER_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    codec.setKeyFailure(null);
    expect(await rawOwner(store)).toBeDefined();
  });

  it("returns conversation_not_found, not conversation_completed, to a non-participant of a completed conversation", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue, "completed");
    store.seedRawParticipation("stranger-9", CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: NOW });

    expect(await writeParticipantNotes("stranger-9", CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
  });

  it("returns conversation_not_found, not conversation_completed, when the participant's memberRef is stale", async () => {
    const setupValue = setup();
    const { state, deps } = setupValue;
    await seedAccepted(setupValue, "completed");
    state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = {
      uid: PARTICIPANT_UID,
      teamId: TEAM_ID,
      createdAt: new Date(0),
      memberRef: "mnpqrstvwxyz0123456789abcd",
    };

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
  });

  it("returns conversation_completed to an authorized accepted participant, with no decrypt and no write", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue, "completed");
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_completed",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns persistence_failed on a key mismatch for an authorized participant, with no write", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);
    codec.setKeyFailure("key_mismatch");

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    codec.setKeyFailure(null);
    expect(await rawOwner(store)).toEqual(before);
  });
});

describe("writeParticipantNotes: denial reasons (BR-21, D2-SI-15)", () => {
  it.each([
    ["a malformed index", async (store: FakeConversationStore) => store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: 7 } as never)],
  ])("returns conversation_not_found for %s", async (_label, breakIndex) => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue);
    await breakIndex(store);
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found for a missing index, with no write", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
    });
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found when the owner document is malformed, with no write", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue);
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { title: "not a canonical document" });
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found when the owner document names a different participant", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue);
    store.seedRawParticipation("participant-2", CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: NOW });
    const before = await rawOwner(store);

    expect(await writeParticipantNotes("participant-2", CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found when the team is disabled, with no write", async () => {
    const setupValue = setup();
    const { store, state, deps } = setupValue;
    await seedAccepted(setupValue);
    state.teamStatus[TEAM_ID] = "disabled";
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });
});

describe("writeParticipantNotes: validation before any read (BR-20, BR-40)", () => {
  it("does not read the store or probe the key for an invalid value", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    let reads = 0;
    let probes = 0;
    const countingStore: ConversationStore = {
      ...store,
      runTransaction: async (work) => {
        reads += 1;
        return store.runTransaction(work);
      },
    };
    const countingCodec = {
      ...codec,
      probeKey: () => {
        probes += 1;
        return codec.probeKey();
      },
    };

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "x".repeat(NOTE_MAX_BYTES + 1), { ...deps, store: countingStore, codec: countingCodec })).toEqual({
      ok: false,
      error: "invalid_input",
      field: "notes",
    });
    expect({ reads, probes }).toEqual({ reads: 0, probes: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// TASK-019 BR-48: every authorization input is re-read inside the transaction, on every attempt (fixtures A to L).
// ---------------------------------------------------------------------------------------------------------------------

const NEW_MEMBER_REF = "mnpqrstvwxyz0123456789abcd";
const PARTICIPANT_MEMBERSHIP_KEY = `${PARTICIPANT_UID}__${TEAM_ID}`;

/** Counts the reads and the mutating calls each transaction attempt makes. Wraps the transaction; changes nothing. */
interface AttemptCounts {
  attempts: number;
  index: number;
  owner: number;
  team: number;
  membership: number;
  mutations: string[];
}

function observe(store: FakeConversationStore): { store: ConversationStore; counts: AttemptCounts } {
  const counts: AttemptCounts = { attempts: 0, index: 0, owner: 0, team: 0, membership: 0, mutations: [] };
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
          getParticipation: (callerUid, conversationId) => {
            counts.index += 1;
            return tx.getParticipation(callerUid, conversationId);
          },
          getOwner: (ownerUid, conversationId) => {
            counts.owner += 1;
            return tx.getOwner(ownerUid, conversationId);
          },
          createOwner: (ownerUid, conversationId, doc) => {
            counts.mutations.push("createOwner");
            tx.createOwner(ownerUid, conversationId, doc);
          },
          setOwner: (ownerUid, conversationId, doc) => {
            counts.mutations.push("setOwner");
            tx.setOwner(ownerUid, conversationId, doc);
          },
          updateOwner: (ownerUid, conversationId, patch) => {
            counts.mutations.push("updateOwner");
            tx.updateOwner(ownerUid, conversationId, patch);
          },
          deleteOwner: (ownerUid, conversationId) => {
            counts.mutations.push("deleteOwner");
            tx.deleteOwner(ownerUid, conversationId);
          },
          setParticipation: (callerUid, conversationId, index) => {
            counts.mutations.push("setParticipation");
            tx.setParticipation(callerUid, conversationId, index);
          },
          deleteParticipation: (callerUid, conversationId) => {
            counts.mutations.push("deleteParticipation");
            tx.deleteParticipation(callerUid, conversationId);
          },
        });
      }),
  };
  return { store: observed, counts };
}

/** The codec with probe and decrypt calls counted, so a test can prove when key state is touched. */
function countKeyUse(codec: FakeContentCodec): { codec: FakeContentCodec; uses: { probe: number; decrypt: number } } {
  const uses = { probe: 0, decrypt: 0 };
  return {
    uses,
    codec: {
      ...codec,
      probeKey: () => {
        uses.probe += 1;
        return codec.probeKey();
      },
      decryptForClassification: (envelope) => {
        uses.decrypt += 1;
        return codec.decryptForClassification(envelope);
      },
    },
  };
}

describe("writeParticipantNotes: transaction-backed authorization (BR-48, TASK-019)", () => {
  it("reads the index, owner, team and membership inside the transaction, once per attempt, and writes only the owner document", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const observed = observe(store);
    const indexBefore = await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, store: observed.store })).toEqual({
      ok: true,
    });

    expect(observed.counts).toEqual({ attempts: 1, index: 1, owner: 1, team: 1, membership: 1, mutations: ["updateOwner"] });
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toEqual(indexBefore);
    expect(decoded(codec, await rawOwner(store)).participantNotes).toBe(PARTICIPANT_NOTE);
  });

  it.each([
    ["B: membership removed before the transactional read", (state: FakeTeamEligibilityState) => delete state.memberships[PARTICIPANT_MEMBERSHIP_KEY]],
    ["D: team disabled", (state: FakeTeamEligibilityState) => (state.teamStatus[TEAM_ID] = "disabled")],
  ])("%s → conversation_not_found, zero owner mutation", async (_label, change) => {
    const setupValue = setup();
    const { store, state, deps } = setupValue;
    await seedAccepted(setupValue);
    change(state);
    const before = await rawOwner(store);
    const observed = observe(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, store: observed.store })).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(observed.counts.mutations).toEqual([]);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("C: membership removed and rejoined with a new memberRef → conversation_not_found, zero owner mutation", async () => {
    const setupValue = setup();
    const { store, state, deps } = setupValue;
    await seedAccepted(setupValue);
    state.memberships[PARTICIPANT_MEMBERSHIP_KEY] = {
      uid: PARTICIPANT_UID,
      teamId: TEAM_ID,
      createdAt: new Date(LATER.getTime()),
      memberRef: NEW_MEMBER_REF,
    };
    const before = await rawOwner(store);
    const observed = observe(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, store: observed.store })).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(observed.counts.mutations).toEqual([]);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("E: a team read operational failure → persistence_failed, zero owner mutation", async () => {
    const setupValue = setup();
    const { store, state, deps } = setupValue;
    await seedAccepted(setupValue);
    state.failTeamRead = true;
    const before = await rawOwner(store);
    const observed = observe(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, store: observed.store })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(observed.counts.mutations).toEqual([]);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("F: a membership read operational failure → persistence_failed, zero owner mutation", async () => {
    const setupValue = setup();
    const { store, state, deps } = setupValue;
    await seedAccepted(setupValue);
    state.failMembershipRead = true;
    const before = await rawOwner(store);
    const observed = observe(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, store: observed.store })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(observed.counts.mutations).toEqual([]);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("G: a retry that sees the membership removed denies, re-reads every input, and does not commit participantNotes", async () => {
    const setupValue = setup();
    const { store, state, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);
    store.scheduleCommitConflicts(1, () => {
      delete state.memberships[PARTICIPANT_MEMBERSHIP_KEY];
    });
    const observed = observe(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, store: observed.store })).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(observed.counts).toMatchObject({ attempts: 2, index: 2, owner: 2, team: 2, membership: 2 });
    expect(await rawOwner(store)).toEqual(before);
    expect(decoded(codec, await rawOwner(store)).participantNotes).toBe("");
  });

  it("G: a retry that sees a replaced memberRef denies, and the discarded attempt's write is not committed", async () => {
    const setupValue = setup();
    const { store, state, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);
    store.scheduleCommitConflicts(1, () => {
      state.memberships[PARTICIPANT_MEMBERSHIP_KEY] = { uid: PARTICIPANT_UID, teamId: TEAM_ID, createdAt: LATER, memberRef: NEW_MEMBER_REF };
    });

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(decoded(codec, await rawOwner(store)).participantNotes).toBe("");
  });

  it("H: a retry that sees the team changed from active to disabled denies, and participantNotes is not committed", async () => {
    const setupValue = setup();
    const { store, state, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);
    store.scheduleCommitConflicts(1, () => {
      state.teamStatus[TEAM_ID] = "disabled";
    });

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(decoded(codec, await rawOwner(store)).participantNotes).toBe("");
  });

  it("a retry with unchanged eligibility re-reads everything and commits the write once", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    store.scheduleCommitConflicts(1);
    const observed = observe(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, store: observed.store })).toEqual({
      ok: true,
    });
    expect(observed.counts).toEqual({ attempts: 2, index: 2, owner: 2, team: 2, membership: 2, mutations: ["updateOwner", "updateOwner"] });
    expect(decoded(codec, await rawOwner(store)).participantNotes).toBe(PARTICIPANT_NOTE);
  });

  it("I: unrelated encrypted content, including shared goals, is preserved after success", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    const sharedGoals = [{ goalTitle: "Synthetic goal", treeId: null, targetDate: null, status: "active" as const, capturedAt: NOW }];
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      ownerNotes: OWNER_NOTE,
      nextSteps: ["Synthetic step"],
      sharedGoals,
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
    });
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: NOW });
    const before = decoded(codec, await rawOwner(store));

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({ ok: true });

    expect(decoded(codec, await rawOwner(store))).toEqual({ ...before, participantNotes: PARTICIPANT_NOTE });
  });

  it("J: a completed, authorized conversation is refused before any key probe or decrypt", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue, "completed");
    const counted = countKeyUse(codec);
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, codec: counted.codec })).toEqual({
      ok: false,
      error: "conversation_completed",
    });
    expect(counted.uses).toEqual({ probe: 0, decrypt: 0 });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("K: an unauthorized caller during a key outage gets conversation_not_found, with zero key probe and decrypt", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);
    codec.setKeyFailure("key_unavailable");
    const counted = countKeyUse(codec);

    expect(await writeParticipantNotes("stranger-9", CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, codec: counted.codec })).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    codec.setKeyFailure(null);
    expect(counted.uses).toEqual({ probe: 0, decrypt: 0 });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("control: an authorized open write probes and decrypts, so the zero counts above are meaningful", async () => {
    const setupValue = setup();
    const { codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const counted = countKeyUse(codec);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, codec: counted.codec })).toEqual({
      ok: true,
    });
    expect(counted.uses.probe).toBeGreaterThan(0);
    expect(counted.uses.decrypt).toBeGreaterThan(0);
  });
});

describe("writeParticipantNotes: failure injection and public result (BR-47, BR-50)", () => {
  it("an encode failure after authorization → persistence_failed, no owner mutation, and the stored payload is kept", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);
    const failingEncode: WriteParticipantNotesDeps["codec"] = {
      ...codec,
      encodeContent: () => ({ ok: false, error: "key_unavailable" }),
    };

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, codec: failingEncode })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(decoded(codec, await rawOwner(store)).participantNotes).toBe("");
  });

  it("an injected commit failure after the work ran → persistence_failed, no mutation", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);
    const failingCommit: ConversationStore = {
      ...store,
      runTransaction: <T>(work: (tx: ConversationTransaction) => Promise<T>) =>
        store.runTransaction<T>(async (tx) => {
          await work(tx);
          throw new Error("simulated commit failure");
        }),
    };

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, store: failingCommit })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(decoded(codec, await rawOwner(store)).participantNotes).toBe("");
  });

  it("an injected owner-update failure → persistence_failed, with no owner and no index mutation", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue);
    const before = await rawOwner(store);
    const indexBefore = await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID);
    const failingUpdate: ConversationStore = {
      ...store,
      runTransaction: <T>(work: (tx: ConversationTransaction) => Promise<T>) =>
        store.runTransaction<T>((tx) =>
          work({
            ...tx,
            updateOwner: () => {
              throw new Error("simulated owner update failure");
            },
          }),
        ),
    };

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, store: failingUpdate })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toEqual(indexBefore);
  });

  it("never mutates the participation index, on success or on refusal", async () => {
    const setupValue = setup();
    const { store, state, deps } = setupValue;
    await seedAccepted(setupValue);
    const indexBefore = await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID);
    const success = observe(store);
    await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, { ...deps, store: success.store });
    state.teamStatus[TEAM_ID] = "disabled";
    const refusal = observe(store);
    await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "Later", { ...deps, store: refusal.store });

    expect(success.counts.mutations.filter((name) => name.includes("Participation"))).toEqual([]);
    expect(refusal.counts.mutations.filter((name) => name.includes("Participation"))).toEqual([]);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toEqual(indexBefore);
  });

  it("the public result carries no uid, memberRef, note text, ciphertext or key-check detail in any outcome", async () => {
    const setupValue = setup();
    const { state, codec, deps } = setupValue;
    await seedAccepted(setupValue);
    const outcomes: unknown[] = [];
    outcomes.push(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps));
    outcomes.push(await writeParticipantNotes("stranger-9", CONVERSATION_ID, PARTICIPANT_NOTE, deps));
    outcomes.push(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "x".repeat(NOTE_MAX_BYTES + 1), deps));
    state.failTeamRead = true;
    outcomes.push(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps));
    state.failTeamRead = false;
    codec.setKeyFailure("key_unavailable");
    outcomes.push(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps));
    codec.setKeyFailure(null);

    const forbidden = [OWNER_UID, PARTICIPANT_UID, PARTICIPANT_MEMBER_REF, PARTICIPANT_NOTE, "ciphertext", "authTag", "keyCheck"];
    for (const outcome of outcomes) {
      const text = JSON.stringify(outcome);
      for (const fragment of forbidden) {
        expect(text, fragment).not.toContain(fragment);
      }
    }
    expect(outcomes[0]).toEqual({ ok: true });
  });
});

describe("writeParticipantNotes: unreadable payload (BR-53, IMPL-1)", () => {
  it("an authorized participant with an unauthenticated payload gets conversation_not_found, and the payload is not overwritten", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAccepted(setupValue);
    const raw = await rawOwner(store);
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, ciphertext: Buffer.from("not-stored", "utf8").toString("base64") });
    const before = await rawOwner(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, PARTICIPANT_NOTE, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(before.ciphertext).not.toBe(raw.ciphertext);
  });
});

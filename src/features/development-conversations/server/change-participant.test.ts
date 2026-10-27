import { describe, expect, it } from "vitest";
import { PARTICIPATION_LIMIT } from "../domain/conversation-constants";
import { changeParticipant, type ChangeParticipantDeps } from "./change-participant";
import type { ConversationStore, RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import type { ParticipantRefReader } from "./member-ref-binding";
import { readParticipantConversation, type ReadParticipantConversationDeps } from "./read-participant-conversation";
import {
  NOW,
  OTHER_OWNER_UID,
  OWNER_UID,
  PARTICIPANT_MEMBER_REF,
  PARTICIPANT_UID,
  TEAM_ID,
  seedOwnerConversation,
} from "./owner-read-test-support";

// Synthetic fixtures only (invariant 15). Every ref satisfies the TASK-002 grammar.
const CONVERSATION_ID = "conv-1";
const LATER = new Date(NOW.getTime() + 60_000);
const OWNER_REF = "0123456789abcdefghjkmnpqrs";
const CANDIDATE_UID = "candidate-2";
const CANDIDATE_REF = "zyxwvtsrqpnmkjhgfedcba9876";
const UNKNOWN_REF = "mnpqrstvwxyz0123456789abcd";

interface SyntheticMember {
  uid: string;
  memberRef: string;
}

const MEMBERS: SyntheticMember[] = [
  { uid: OWNER_UID, memberRef: OWNER_REF },
  { uid: PARTICIPANT_UID, memberRef: PARTICIPANT_MEMBER_REF },
  { uid: CANDIDATE_UID, memberRef: CANDIDATE_REF },
];

function membership({ uid, memberRef }: SyntheticMember): Record<string, unknown> {
  return { uid, teamId: TEAM_ID, createdAt: new Date(0), memberRef };
}

type RefReader = ParticipantRefReader & { listCalls: number };

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  state: FakeTeamEligibilityState;
  reader: RefReader;
  deps: ChangeParticipantDeps;
}

function refReaderFor(state: FakeTeamEligibilityState): RefReader {
  const point = createFakeTeamEligibilityReader(state);
  const reader: RefReader = {
    ...point,
    listCalls: 0,
    async listMemberships(_teamId: string, limit: number) {
      reader.listCalls += 1;
      return MEMBERS.slice(0, limit).map(membership);
    },
  };
  return reader;
}

function setup(): Setup {
  const store = createFakeConversationStore();
  const codec = createFakeContentCodec();
  const state: FakeTeamEligibilityState = {
    teamStatus: { [TEAM_ID]: "active" },
    memberships: Object.fromEntries(MEMBERS.map((member) => [`${member.uid}__${TEAM_ID}`, membership(member)])),
  };
  const reader = refReaderFor(state);
  const deps: ChangeParticipantDeps = { store, codec, refReader: reader, clock: () => new Date(NOW.getTime()) };
  return { store, codec, state, reader, deps };
}

async function rawOwner(store: ConversationStore, ownerUid = OWNER_UID): Promise<RawConversationData> {
  const raw = await store.getOwner(ownerUid, CONVERSATION_ID);
  if (raw === undefined) throw new Error("fixture document missing");
  return raw;
}

/** The decrypted payload, read through the synthetic codec only to assert on it. */
function decodedNotes(codec: FakeContentCodec, raw: RawConversationData): { participantNotes: string; ownerNotes: string; title: string } {
  const decoded = codec.decodeContent({
    ciphertext: raw.ciphertext as string,
    iv: raw.iv as string,
    authTag: raw.authTag as string,
    keyVersion: raw.keyVersion as string,
    keyCheck: raw.keyCheck as string,
  } as Parameters<FakeContentCodec["decodeContent"]>[0]);
  if (!decoded.ok) throw new Error("fixture payload does not decode");
  return { participantNotes: decoded.content.participantNotes, ownerNotes: decoded.content.ownerNotes, title: decoded.content.title };
}

/** The TASK-017 participant read, over the same fakes. Only the access check is under test here. */
function readDeps(store: FakeConversationStore, codec: FakeContentCodec, state: FakeTeamEligibilityState): ReadParticipantConversationDeps {
  return {
    store,
    codec,
    teamReader: createFakeTeamEligibilityReader(state),
    teamNameReader: { getTeamName: async () => "Synthetic team" },
    areaNameReader: { getSkillTree: async () => undefined },
    getNames: async () => new Map(),
  };
}

/** Seeds an accepted participant with notes, so a removal has visible effects to check. */
async function seedAcceptedWithNotes(setupValue: Setup, status: "open" | "completed" = "open"): Promise<void> {
  await seedOwnerConversation(setupValue.store, setupValue.codec, {
    conversationId: CONVERSATION_ID,
    title: "Kept title",
    ownerNotes: "Kept owner notes",
    nextSteps: ["Kept step"],
    plannedFor: "2026-11-03",
    participant: { uid: PARTICIPANT_UID, state: "accepted" },
    participantNotes: "Participant's private note",
    status,
  });
  setupValue.store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: NOW });
}

async function seedPendingWithNotes(setupValue: Setup): Promise<void> {
  await seedOwnerConversation(setupValue.store, setupValue.codec, {
    conversationId: CONVERSATION_ID,
    title: "Kept title",
    participant: { uid: PARTICIPANT_UID, state: "pending" },
    participantNotes: "",
  });
  setupValue.store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: NOW });
}

describe("changeParticipant: removal (BR-16, CL-21)", () => {
  it.each(["open", "completed"] as const)("removes an accepted participant in %s: index deleted, fields cleared, notes deleted, owner content kept", async (status) => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue, status);
    const before = await rawOwner(store);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, { ...deps, clock: () => new Date(LATER.getTime()) })).toEqual({
      ok: true,
    });

    const after = await rawOwner(store);
    expect(after.participantUid).toBeNull();
    expect(after.participantMemberRef).toBeNull();
    expect(after.participantState).toBeNull();
    expect(after.participantInvitedAt).toBeNull();
    expect(after.participantAcceptedAt).toBeNull();
    expect(after.updatedAt).toEqual(LATER);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();

    const content = decodedNotes(codec, after);
    expect(content.participantNotes).toBe("");
    expect(content.ownerNotes).toBe("Kept owner notes");
    expect(content.title).toBe("Kept title");
    for (const key of ["teamId", "plannedFor", "status", "completedAt", "createdAt"] as const) {
      expect(after[key], key).toEqual(before[key]);
    }
  });

  it("removes a pending invitation in open, with no content to delete", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedPendingWithNotes(setupValue);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, deps)).toEqual({ ok: true });

    const after = await rawOwner(store);
    expect(after.participantUid).toBeNull();
    expect(after.participantState).toBeNull();
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("removes an ineligible accepted participant, since removal does no eligibility check (BR-18)", async () => {
    const setupValue = setup();
    const { store, state, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    state.teamStatus[TEAM_ID] = "disabled";
    delete state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, deps)).toEqual({ ok: true });

    const after = await rawOwner(store);
    expect(after.participantUid).toBeNull();
    expect(decodedNotes(setupValue.codec, after).participantNotes).toBe("");
  });

  it("ends the former participant's access: their next read is conversation_not_found (TASK-017)", async () => {
    const setupValue = setup();
    const { store, codec, state, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, readDeps(store, codec, state))).toMatchObject({ ok: true });

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, deps)).toEqual({ ok: true });

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, readDeps(store, codec, state))).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
  });

  it("is an idempotent no-op when there is no participant: no write and no updatedAt change", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, { ...deps, clock: () => new Date(LATER.getTime()) })).toEqual({
      ok: true,
      noop: true,
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("reports an actual removal as a change, never as a no-op (the route reads the owner DTO only for a no-op)", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);

    const result = await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, deps);
    expect(result).toEqual({ ok: true });
    expect(result).not.toHaveProperty("noop");
    expect((await rawOwner(store)).participantUid).toBeNull();
  });

  it("returns persistence_failed on a key outage, with no write (IMPL-1)", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    const before = await rawOwner(store);
    codec.setKeyFailure("key_unavailable");

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    codec.setKeyFailure(null);
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("returns conversation_not_found for an unauthenticated payload and writes nothing (IMPL-1)", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    const raw = await rawOwner(store);
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, ciphertext: Buffer.from("no-such-handle").toString("base64") });
    const before = await rawOwner(store);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("returns conversation_not_found for a missing conversation and a malformed id", async () => {
    const { deps } = setup();

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await changeParticipant(OWNER_UID, "bad id!", { participantMemberRef: null }, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
  });

  it("does not reach another owner's conversation of the same id", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    const before = await rawOwner(store);

    expect(await changeParticipant(OTHER_OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, deps)).toEqual({
      ok: false,
      error: "conversation_not_found",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("removes the access in one transaction: a failed index delete leaves the participation intact", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    const before = await rawOwner(store);
    const failingIndex: ChangeParticipantDeps["store"] = {
      ...store,
      runTransaction: (work) =>
        store.runTransaction((tx) =>
          work({
            ...tx,
            deleteParticipation() {
              throw new Error("simulated index delete failure");
            },
          }),
        ),
    };

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, { ...deps, store: failingIndex })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("does not leak the raw error text on an operational failure", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    const failing: ChangeParticipantDeps["store"] = {
      ...store,
      runTransaction: () => Promise.reject(new Error("raw firestore detail")),
    };

    const result = await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, { ...deps, store: failing });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("raw firestore detail");
  });
});

describe("changeParticipant: input shape", () => {
  it.each([
    ["not an object", null],
    ["an empty object", {}],
    ["an extra key", { participantMemberRef: null, status: "completed" }],
    ["an array", [null]],
  ])("returns invalid_input for %s, before any read", async (_label, input) => {
    const setupValue = setup();
    const { store, deps, reader } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    const before = await rawOwner(store);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, input, deps)).toEqual({ ok: false, error: "invalid_input" });
    expect(reader.listCalls).toBe(0);
    expect(await rawOwner(store)).toEqual(before);
  });
});

describe("changeParticipant: replacement (BR-10, BR-16)", () => {
  it("replaces an open participant: old index removed, new pending invitation written, notes deleted", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    const before = await rawOwner(store);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: CANDIDATE_REF }, deps)).toEqual({ ok: true });

    const after = await rawOwner(store);
    expect(after.participantUid).toBe(CANDIDATE_UID);
    expect(after.participantMemberRef).toBe(CANDIDATE_REF);
    expect(after.participantState).toBe("pending");
    expect(after.participantInvitedAt).toEqual(NOW);
    expect(after.participantAcceptedAt).toBeNull();
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toEqual({ ownerUid: OWNER_UID, invitedAt: NOW });
    expect(decodedNotes(codec, after).participantNotes).toBe("");
    expect(decodedNotes(codec, after).ownerNotes).toBe(decodedNotes(codec, before).ownerNotes);
    expect(after.plannedFor).toEqual(before.plannedFor);
  });

  it("writes only the new invitation when there is no current participant (same effects as TASK-014 invitation)", async () => {
    const setupValue = setup();
    const { store, codec, deps } = setupValue;
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: CANDIDATE_REF }, deps)).toEqual({ ok: true });

    const after = await rawOwner(store);
    expect(after.participantUid).toBe(CANDIDATE_UID);
    expect(after.participantState).toBe("pending");
    expect(after.ciphertext).toBe(before.ciphertext);
    expect(after.iv).toBe(before.iv);
  });

  it("refuses a replacement on a completed conversation with conversation_completed, and writes nothing", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue, "completed");
    const before = await rawOwner(store);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: CANDIDATE_REF }, deps)).toEqual({
      ok: false,
      error: "conversation_completed",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
    expect(await store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("refuses an unknown replacement ref with invalid_participant, and the old participation stays", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    const before = await rawOwner(store);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: UNKNOWN_REF }, deps)).toEqual({
      ok: false,
      error: "invalid_participant",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("validates the new candidate: an ineligible candidate is invalid_participant, with zero writes", async () => {
    const setupValue = setup();
    const { store, state, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    delete state.memberships[`${CANDIDATE_UID}__${TEAM_ID}`];
    const before = await rawOwner(store);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: CANDIDATE_REF }, deps)).toEqual({
      ok: false,
      error: "invalid_participant",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses a replacement whose candidate is at the participation cap, with zero writes", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    for (let index = 0; index < PARTICIPATION_LIMIT; index += 1) {
      store.seedRawParticipation(CANDIDATE_UID, `filler-${index}`, { ownerUid: OTHER_OWNER_UID, invitedAt: new Date(0) });
    }
    const before = await rawOwner(store);

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: CANDIDATE_REF }, deps)).toEqual({
      ok: false,
      error: "invalid_participant",
    });
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("keeps the old participation intact when the new index write fails inside the transaction (atomicity)", async () => {
    const setupValue = setup();
    const { store, deps } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    const before = await rawOwner(store);
    const failingNewIndex: ChangeParticipantDeps["store"] = {
      ...store,
      runTransaction: (work) =>
        store.runTransaction((tx) =>
          work({
            ...tx,
            setParticipation() {
              throw new Error("simulated new index write failure");
            },
          }),
        ),
    };

    expect(
      await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: CANDIDATE_REF }, { ...deps, store: failingNewIndex }),
    ).toEqual({ ok: false, error: "persistence_failed" });
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
    expect(await store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("returns persistence_failed on a key outage before any read, with no candidate lookup", async () => {
    const setupValue = setup();
    const { store, codec, deps, reader } = setupValue;
    await seedAcceptedWithNotes(setupValue);
    const before = await rawOwner(store);
    codec.setKeyFailure("key_unavailable");

    expect(await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: CANDIDATE_REF }, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(reader.listCalls).toBe(0);
    codec.setKeyFailure(null);
    expect(await rawOwner(store)).toEqual(before);
  });
});

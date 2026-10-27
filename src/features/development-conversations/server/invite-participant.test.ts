import { describe, expect, it } from "vitest";
import { PARTICIPATION_LIMIT } from "../domain/conversation-constants";
import type { ConversationStore, RawConversationData } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { inviteParticipant, type InviteParticipantDeps } from "./invite-participant";
import type { ParticipantRefReader } from "./member-ref-binding";
import { NOW, OTHER_OWNER_UID, OWNER_UID, TEAM_ID, seedOwnerConversation } from "./owner-read-test-support";

// Synthetic fixtures only (invariant 15). Every ref satisfies the TASK-002 grammar.
const CONVERSATION_ID = "conv-1";
const LATER = new Date(NOW.getTime() + 60_000);
const OWNER_REF = "0123456789abcdefghjkmnpqrs";
const CANDIDATE_UID = "candidate-2";
const CANDIDATE_REF = "zyxwvtsrqpnmkjhgfedcba9876";
const REJOINED_REF = "abcdefghjkmnpqrstvwxyz0123";
const UNKNOWN_REF = "mnpqrstvwxyz0123456789abcd";

interface SyntheticMember {
  uid: string;
  memberRef: string;
  teamId?: string;
  role?: "lead";
}

function membership({ uid, memberRef, teamId = TEAM_ID, role }: SyntheticMember): Record<string, unknown> {
  return { uid, teamId, createdAt: new Date(0), memberRef, ...(role === undefined ? {} : { role }) };
}

const DEFAULT_MEMBERS: SyntheticMember[] = [
  { uid: OWNER_UID, memberRef: OWNER_REF },
  { uid: CANDIDATE_UID, memberRef: CANDIDATE_REF },
];

type RefReader = ParticipantRefReader & { listCalls: number };

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  state: FakeTeamEligibilityState;
  reader: RefReader;
  deps: InviteParticipantDeps;
}

/**
 * Test-local ref reader: the TASK-006 point reads plus the bounded membership list, over the same synthetic documents.
 * `onList` runs after the resolution has read its data and before the invitation transaction, to inject a race.
 */
function refReaderFor(state: FakeTeamEligibilityState, members: SyntheticMember[], onList?: () => Promise<void>): RefReader {
  const point = createFakeTeamEligibilityReader(state);
  const reader: RefReader = {
    ...point,
    listCalls: 0,
    async listMemberships(_teamId: string, limit: number) {
      reader.listCalls += 1;
      if (state.failMembershipRead) throw new Error("simulated list failure");
      const result = members.slice(0, limit).map(membership);
      if (onList !== undefined) await onList();
      return result;
    },
  };
  return reader;
}

function setup(options: { members?: SyntheticMember[]; onList?: () => Promise<void> } = {}): Setup {
  const members = options.members ?? DEFAULT_MEMBERS;
  const store = createFakeConversationStore();
  const codec = createFakeContentCodec();
  const state: FakeTeamEligibilityState = {
    teamStatus: { [TEAM_ID]: "active" },
    memberships: Object.fromEntries(members.map((member) => [`${member.uid}__${TEAM_ID}`, membership(member)])),
  };
  const reader = refReaderFor(state, members, options.onList);
  const deps: InviteParticipantDeps = { store, codec, refReader: reader, clock: () => new Date(NOW.getTime()) };
  return { store, codec, state, reader, deps };
}

async function rawOwner(store: ConversationStore, ownerUid = OWNER_UID): Promise<RawConversationData> {
  const raw = await store.getOwner(ownerUid, CONVERSATION_ID);
  if (raw === undefined) throw new Error("fixture document missing");
  return raw;
}

/** Fills a candidate's participation index with synthetic, unrelated conversation ids. */
function fillIndex(store: FakeConversationStore, callerUid: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    store.seedRawParticipation(callerUid, `filler-${index}`, { ownerUid: OTHER_OWNER_UID, invitedAt: new Date(0) });
  }
}

describe("inviteParticipant: successful invitation (BR-10, BR-11)", () => {
  it("writes the owner's pending fields and the candidate's index, and returns only ok", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: true });

    const raw = await rawOwner(store);
    expect(raw.participantUid).toBe(CANDIDATE_UID);
    expect(raw.participantMemberRef).toBe(CANDIDATE_REF);
    expect(raw.participantState).toBe("pending");
    expect(raw.participantInvitedAt).toEqual(NOW);
    expect(raw.participantAcceptedAt).toBeNull();
    expect(await store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toEqual({ ownerUid: OWNER_UID, invitedAt: NOW });
  });

  it("does not return the candidate uid or memberRef", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });

    const serialized = JSON.stringify(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps));
    expect(serialized).not.toContain(CANDIDATE_UID);
    expect(serialized).not.toContain(CANDIDATE_REF);
  });

  it("leaves the encrypted content byte-identical and the other owner fields unchanged", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      title: "Kept title",
      ownerNotes: "Kept owner notes",
      nextSteps: ["Kept step"],
      plannedFor: "2026-11-03",
    });
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, { ...deps, clock: () => new Date(LATER.getTime()) })).toEqual({
      ok: true,
    });

    const after = await rawOwner(store);
    expect(after.ciphertext).toBe(before.ciphertext);
    expect(after.iv).toBe(before.iv);
    expect(after.authTag).toBe(before.authTag);
    expect(after.keyCheck).toBe(before.keyCheck);
    for (const key of ["teamId", "plannedFor", "status", "completedAt", "createdAt"] as const) {
      expect(after[key], key).toEqual(before[key]);
    }
    expect(after.updatedAt).toEqual(LATER);
  });

  it("accepts a candidate whose team role is lead, since a role neither qualifies nor disqualifies (BR-9)", async () => {
    const { store, codec, deps } = setup({
      members: [
        { uid: OWNER_UID, memberRef: OWNER_REF },
        { uid: CANDIDATE_UID, memberRef: CANDIDATE_REF, role: "lead" },
      ],
    });
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: true });
  });

  it("allows the index up to the limit minus one, and refuses the next (BR-37 boundary)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    fillIndex(store, CANDIDATE_UID, PARTICIPATION_LIMIT - 1);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: true });
    expect(await store.countParticipation(CANDIDATE_UID)).toBe(PARTICIPATION_LIMIT);
  });
});

describe("inviteParticipant: uniform invalid_participant (BR-8, BR-9, BR-32, D2-SI-15)", () => {
  it.each([
    ["an unknown ref", UNKNOWN_REF, DEFAULT_MEMBERS],
    ["the owner's own ref (self)", OWNER_REF, DEFAULT_MEMBERS],
    ["a candidate with no membership", CANDIDATE_REF, [{ uid: OWNER_UID, memberRef: OWNER_REF }]],
    ["a non-string selection", 42 as unknown as string, DEFAULT_MEMBERS],
    ["a null selection", null as unknown as string, DEFAULT_MEMBERS],
    ["a malformed ref", "short", DEFAULT_MEMBERS],
    [
      "the old ref after the candidate rejoined with a new memberRef",
      CANDIDATE_REF,
      [
        { uid: OWNER_UID, memberRef: OWNER_REF },
        { uid: CANDIDATE_UID, memberRef: REJOINED_REF },
      ],
    ],
    [
      "a candidate whose membership belongs to another team",
      CANDIDATE_REF,
      [
        { uid: OWNER_UID, memberRef: OWNER_REF },
        { uid: CANDIDATE_UID, memberRef: CANDIDATE_REF, teamId: "team-other" },
      ],
    ],
  ])("refuses %s with zero writes", async (_label, ref, members) => {
    const { store, codec, deps } = setup({ members });
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, ref, deps)).toEqual({ ok: false, error: "invalid_participant" });
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
  });

  it("refuses when the team is disabled (candidate and owner both ineligible), with zero writes", async () => {
    const { store, codec, state, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    state.teamStatus[TEAM_ID] = "disabled";
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "invalid_participant" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses an owner without an active membership, with zero writes", async () => {
    const { store, codec, state, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    delete state.memberships[`${OWNER_UID}__${TEAM_ID}`];
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "invalid_participant" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses a second invitation while one is already pending (BR-11), with zero writes", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      participant: { uid: CANDIDATE_UID, state: "pending" },
    });
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "invalid_participant" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses an invitation over an accepted participant, with zero writes (replacement goes through TASK-018)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, {
      conversationId: CONVERSATION_ID,
      participant: { uid: CANDIDATE_UID, state: "accepted" },
    });
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "invalid_participant" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses a conversation without a teamId, with no membership read and zero writes", async () => {
    const { store, codec, deps, reader } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, teamId: null });
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "invalid_participant" });
    expect(reader.listCalls).toBe(0);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("refuses when the candidate's index is already at the participation cap, with zero writes", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    fillIndex(store, CANDIDATE_UID, PARTICIPATION_LIMIT);
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "invalid_participant" });
    expect(await rawOwner(store)).toEqual(before);
    expect(await store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
  });
});

describe("inviteParticipant: conversation state and owner namespace", () => {
  it("returns conversation_completed for a completed conversation with a valid candidate", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, status: "completed" });
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "conversation_completed" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns invalid_participant for a completed conversation with an unknown ref (resolution runs first)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, status: "completed" });

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, UNKNOWN_REF, deps)).toEqual({ ok: false, error: "invalid_participant" });
  });

  it("returns conversation_not_found for a malformed id before any read", async () => {
    const { deps, reader } = setup();
    expect(await inviteParticipant(OWNER_UID, "bad id!", CANDIDATE_REF, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(reader.listCalls).toBe(0);
  });

  it("returns conversation_not_found for a missing conversation", async () => {
    const { deps, reader } = setup();
    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(reader.listCalls).toBe(0);
  });

  it("does not reach another owner's conversation of the same id", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { ownerUid: OTHER_OWNER_UID, conversationId: CONVERSATION_ID });
    const before = await rawOwner(store, OTHER_OWNER_UID);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await rawOwner(store, OTHER_OWNER_UID)).toEqual(before);
  });

  it("returns conversation_not_found for a malformed stored conversation and does not repair it", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const raw = await rawOwner(store);
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, status: "archived" });
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found for an unauthenticated payload and writes nothing", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const raw = await rawOwner(store);
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, ciphertext: Buffer.from("no-such-handle").toString("base64") });
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns conversation_not_found for a decrypted payload that fails the content rules", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const bad = codec.encodeContent({
      title: "Bad payload",
      ownerNotes: "",
      nextSteps: Array.from({ length: 999 }, () => "step"),
      participantNotes: "",
      sharedGoals: [],
    });
    if (!bad.ok) throw new Error("fixture key unavailable");
    const raw = await rawOwner(store);
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, ...bad.content });
    const before = await rawOwner(store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await rawOwner(store)).toEqual(before);
  });
});

describe("inviteParticipant: operational failures are never invalid_participant", () => {
  it("returns persistence_failed on a key outage before any read", async () => {
    const { store, codec, deps, reader } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    codec.setKeyFailure("key_unavailable");

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(reader.listCalls).toBe(0);
  });

  it("returns persistence_failed on a configured-key mismatch, with no write", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);
    codec.setKeyFailure("key_mismatch");

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps)).toEqual({ ok: false, error: "persistence_failed" });
    codec.setKeyFailure(null);
    expect(await rawOwner(store)).toEqual(before);
  });

  it("returns persistence_failed when the membership list read fails, without leaking the raw error", async () => {
    const { store, codec, state, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    state.failMembershipRead = true;

    const result = await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, deps);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("simulated");
  });

  it("returns persistence_failed when the participation count read fails", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const failingCount: InviteParticipantDeps["store"] = {
      ...store,
      countParticipation: async () => {
        throw new Error("simulated count failure");
      },
    };

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, { ...deps, store: failingCount })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
  });
});

describe("inviteParticipant: transaction atomicity (BR-48)", () => {
  it("writes no index when the owner update fails inside the transaction", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);
    const failingOwner: InviteParticipantDeps["store"] = {
      ...store,
      runTransaction: (work) =>
        store.runTransaction((tx) =>
          work({
            ...tx,
            updateOwner() {
              throw new Error("simulated owner write failure");
            },
          }),
        ),
    };

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, { ...deps, store: failingOwner })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await rawOwner(store)).toEqual(before);
  });

  it("persists neither document when the index write fails inside the transaction", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);
    const failingIndex: InviteParticipantDeps["store"] = {
      ...store,
      runTransaction: (work) =>
        store.runTransaction((tx) =>
          work({
            ...tx,
            setParticipation() {
              throw new Error("simulated index write failure");
            },
          }),
        ),
    };

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, { ...deps, store: failingIndex })).toEqual({
      ok: false,
      error: "persistence_failed",
    });
    expect(await rawOwner(store)).toEqual(before);
  });

  it("persists neither document when the whole transaction fails, and does not leak the raw error", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(store);
    const failing: InviteParticipantDeps["store"] = {
      ...store,
      runTransaction: async () => {
        throw new Error("simulated transaction failure with a secret path");
      },
    };

    const result = await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, { ...deps, store: failing });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret path");
    expect(await store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
    expect(await rawOwner(store)).toEqual(before);
  });
});

describe("inviteParticipant: state changes between resolution and commit", () => {
  it("refuses when the conversation completes after resolution, with no index and no owner write", async () => {
    const local: Setup = setup({
      onList: async () => {
        await local.store.runTransaction(async (tx) => {
          tx.updateOwner(OWNER_UID, CONVERSATION_ID, { status: "completed", completedAt: LATER, updatedAt: LATER });
        });
      },
    });
    await seedOwnerConversation(local.store, local.codec, { conversationId: CONVERSATION_ID });
    const before = await rawOwner(local.store);

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, local.deps)).toEqual({ ok: false, error: "conversation_completed" });
    expect(await local.store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
    expect((await rawOwner(local.store)).ciphertext).toBe(before.ciphertext);
  });

  it("refuses when the conversation's teamId changes after resolution, and does not reveal the new team", async () => {
    const local: Setup = setup({
      onList: async () => {
        const raw = await local.store.getOwner(OWNER_UID, CONVERSATION_ID);
        if (raw !== undefined) local.store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, teamId: "team-other" });
      },
    });
    await seedOwnerConversation(local.store, local.codec, { conversationId: CONVERSATION_ID });

    const result = await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, local.deps);
    expect(result).toEqual({ ok: false, error: "invalid_participant" });
    expect(JSON.stringify(result)).not.toContain("team-other");
    expect(await local.store.getParticipation(CANDIDATE_UID, CONVERSATION_ID)).toBeUndefined();
    expect((await rawOwner(local.store)).participantUid).toBeNull();
  });

  it("commits the pending invitation when the candidate is removed after resolution (no commit-time membership re-read; BR-21 governs access)", async () => {
    // The removal lands after the full resolution (owner and candidate reads) and before the transaction. The count is
    // the last step before the transaction, so it is the hook point.
    const { store, codec, state, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID });
    const removingCount: InviteParticipantDeps["store"] = {
      ...store,
      countParticipation: async (uid) => {
        delete state.memberships[`${CANDIDATE_UID}__${TEAM_ID}`];
        return store.countParticipation(uid);
      },
    };

    expect(await inviteParticipant(OWNER_UID, CONVERSATION_ID, CANDIDATE_REF, { ...deps, store: removingCount })).toEqual({ ok: true });
    expect((await rawOwner(store)).participantUid).toBe(CANDIDATE_UID);
  });
});

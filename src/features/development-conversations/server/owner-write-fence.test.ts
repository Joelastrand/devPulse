import { describe, expect, it } from "vitest";
import { changeParticipant } from "./change-participant";
import { completeConversation } from "./complete-conversation";
import { createConversation } from "./create-conversation";
import { deleteConversation, deleteConversationForErasure } from "./delete-conversation";
import { issueErasureOwnerCleanupCapability } from "./erasure-owner-cleanup-capability";
import type { ConversationStore } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { inviteParticipant } from "./invite-participant";
import type { ParticipantRefReader } from "./member-ref-binding";
import { setSharedGoals } from "./set-shared-goals";
import { NOW, OWNER_UID, PARTICIPANT_UID, TEAM_ID, rosterTeam, seedOwnerConversation } from "./owner-read-test-support";
import { updateOwnerSections } from "./update-owner-sections";
import type { FakeConversationStore } from "./fake-conversation-store";

// TASK-027: every owner write route refuses while the owner's erasure record exists, and leaves the conversation as it was
// (BR-4(b)). The erasure's own owner cleanup is the one unfenced caller (TASK-018). Fixtures are synthetic.

const CONVERSATION_ID = "conv-fence-1";
const CANDIDATE_UID = "candidate-fence";
const CANDIDATE_REF = "zyxwvtsrqpnmkjhgfedcba9876";
const OWNER_REF = "0123456789abcdefghjkmnpqrs";
const CLOCK = () => new Date(NOW.getTime() + 60_000);
const REFUSED = { ok: false, error: "erasure_in_progress" };

/** A store whose owner uid has an erasure record in progress, with one open conversation already written. */
async function erasingOwner(): Promise<{ store: FakeConversationStore; codec: FakeContentCodec }> {
  const store = createFakeConversationStore({ erasingUids: [OWNER_UID], teams: rosterTeam([OWNER_UID, PARTICIPANT_UID]) });
  const codec = createFakeContentCodec();
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    title: "Synthetic title",
    participant: { uid: PARTICIPANT_UID, state: "accepted" },
  });
  return { store, codec };
}

async function ownerDoc(store: ConversationStore) {
  return store.getOwner(OWNER_UID, CONVERSATION_ID);
}

/** A ref reader over synthetic memberships, for the invite and replacement paths. */
function refReader(state: FakeTeamEligibilityState): ParticipantRefReader {
  const point = createFakeTeamEligibilityReader(state);
  return {
    ...point,
    async listMemberships() {
      return [
        { uid: OWNER_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: OWNER_REF },
        { uid: CANDIDATE_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: CANDIDATE_REF },
      ];
    },
  };
}

describe("owner write routes are fenced by the erasure record (TASK-027, BR-4(b))", () => {
  it("create refuses and writes no conversation", async () => {
    const store = createFakeConversationStore({ erasingUids: [OWNER_UID] });
    const codec = createFakeContentCodec();
    const teamReader = createFakeTeamEligibilityReader(rosterTeam([OWNER_UID]));
    const result = await createConversation(OWNER_UID, { title: "Synthetic" }, { store, codec, teamReader, clock: CLOCK });
    expect(result).toEqual(REFUSED);
    expect(await store.listOwnerWindow(OWNER_UID)).toMatchObject({ docs: [] });
  });

  it("invite refuses and binds no participant", async () => {
    const { store, codec } = await erasingOwner();
    const state: FakeTeamEligibilityState = {
      teamStatus: { [TEAM_ID]: "active" },
      memberships: {
        [`${OWNER_UID}__${TEAM_ID}`]: { uid: OWNER_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: OWNER_REF },
        [`${CANDIDATE_UID}__${TEAM_ID}`]: { uid: CANDIDATE_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: CANDIDATE_REF },
      },
    };
    const doc = await seedFresh(store, codec);
    const before = await store.getOwner(OWNER_UID, doc);
    const result = await inviteParticipant(OWNER_UID, doc, CANDIDATE_REF, { store, codec, refReader: refReader(state), clock: CLOCK });
    expect(result).toEqual(REFUSED);
    expect(await store.getOwner(OWNER_UID, doc)).toEqual(before);
  });

  it("change participant refuses and keeps the bound participant", async () => {
    const { store, codec } = await erasingOwner();
    const before = await ownerDoc(store);
    const state: FakeTeamEligibilityState = { teamStatus: { [TEAM_ID]: "active" }, memberships: {} };
    const result = await changeParticipant(OWNER_UID, CONVERSATION_ID, { participantMemberRef: null }, {
      store,
      codec,
      refReader: refReader(state),
      clock: CLOCK,
    });
    expect(result).toEqual(REFUSED);
    expect(await ownerDoc(store)).toEqual(before);
  });

  it("complete refuses and leaves the conversation open", async () => {
    const { store } = await erasingOwner();
    const before = await ownerDoc(store);
    expect(await completeConversation(OWNER_UID, CONVERSATION_ID, { store, clock: CLOCK })).toEqual(REFUSED);
    expect(await ownerDoc(store)).toEqual(before);
  });

  it("delete refuses and keeps the conversation", async () => {
    const { store } = await erasingOwner();
    expect(await deleteConversation(OWNER_UID, CONVERSATION_ID, { store })).toEqual(REFUSED);
    expect(await ownerDoc(store)).toBeDefined();
  });

  it("the erasure's own owner cleanup, holding its capability, is unfenced and still deletes (TASK-018, TASK-027)", async () => {
    const { store } = await erasingOwner();
    const capability = issueErasureOwnerCleanupCapability();
    expect(await deleteConversationForErasure(capability, OWNER_UID, CONVERSATION_ID, store)).toEqual({ ok: true });
    expect(await ownerDoc(store)).toBeUndefined();
  });

  it("shared goals refuse and leave the stored set unchanged", async () => {
    const { store, codec } = await erasingOwner();
    const before = await ownerDoc(store);
    const goalStore = { get: async () => undefined };
    expect(await setSharedGoals(OWNER_UID, CONVERSATION_ID, [], { store, codec, goalStore, clock: CLOCK })).toEqual(REFUSED);
    expect(await ownerDoc(store)).toEqual(before);
  });

  it("owner sections refuse and leave the title unchanged", async () => {
    const { store, codec } = await erasingOwner();
    const before = await ownerDoc(store);
    expect(await updateOwnerSections(OWNER_UID, CONVERSATION_ID, { title: "Synthetic new title" }, { store, codec, clock: CLOCK })).toEqual(REFUSED);
    expect(await ownerDoc(store)).toEqual(before);
  });
});

/** Writes one open conversation with no participant, for the invite path, and returns its id. */
async function seedFresh(store: FakeConversationStore, codec: FakeContentCodec): Promise<string> {
  await seedOwnerConversation(store, codec, {
    conversationId: `${CONVERSATION_ID}-empty`,
    title: "Synthetic title",
  });
  return `${CONVERSATION_ID}-empty`;
}

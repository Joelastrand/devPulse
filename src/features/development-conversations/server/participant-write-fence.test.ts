import { describe, expect, it } from "vitest";
import { createFakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore } from "./fake-conversation-store";
import { acceptInvitation, leaveParticipation } from "./respond-to-participation";
import { NOW, OWNER_UID, PARTICIPANT_UID, seedOwnerConversation } from "./owner-read-test-support";
import { writeParticipantNotes } from "./write-participant-notes";
import type { ConversationStore } from "./conversation-store-types";

// TASK-028: every participant write route refuses while the acting participant's erasure record exists (BR-4(b)), and leaves
// the conversation and the participant's index as they were. Fixtures are synthetic.

const CONVERSATION_ID = "conv-part-fence-1";
const CLOCK = () => new Date(NOW.getTime() + 60_000);
const REFUSED = { ok: false, error: "erasure_in_progress" };

/** The participant is erasing, and a conversation names them as participant in the given state. */
async function erasingParticipant(state: "pending" | "accepted") {
  const store = createFakeConversationStore({ erasingUids: [PARTICIPANT_UID] });
  const codec = createFakeContentCodec();
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    title: "Synthetic title",
    ownerNotes: "Synthetic owner note",
    participantNotes: "Synthetic note",
    participant: { uid: PARTICIPANT_UID, state },
  });
  store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: NOW });
  return { store, codec };
}

async function ownerDoc(store: ConversationStore) {
  return store.getOwner(OWNER_UID, CONVERSATION_ID);
}

describe("participant write routes are fenced by the erasure record (TASK-028, BR-4(b))", () => {
  it("accept refuses and leaves the invitation pending", async () => {
    const { store, codec } = await erasingParticipant("pending");
    const before = await ownerDoc(store);

    expect(await acceptInvitation(PARTICIPANT_UID, CONVERSATION_ID, { store, codec, clock: CLOCK })).toEqual(REFUSED);
    expect(await ownerDoc(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("leave refuses and keeps the participant bound and indexed", async () => {
    const { store, codec } = await erasingParticipant("accepted");
    const before = await ownerDoc(store);

    expect(await leaveParticipation(PARTICIPANT_UID, CONVERSATION_ID, { store, codec, clock: CLOCK })).toEqual(REFUSED);
    expect(await ownerDoc(store)).toEqual(before);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toBeDefined();
  });

  it("participant notes refuse and keep the stored notes", async () => {
    const { store, codec } = await erasingParticipant("accepted");
    const before = await ownerDoc(store);

    expect(await writeParticipantNotes(PARTICIPANT_UID, CONVERSATION_ID, "Synthetic new note", { store, codec, clock: CLOCK })).toEqual(
      REFUSED,
    );
    expect(await ownerDoc(store)).toEqual(before);
  });
});

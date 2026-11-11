import { describe, expect, it } from "vitest";
import type { SharedEvidenceSnapshot } from "../domain/shared-evidence-snapshot";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { NOW, OWNER_UID, PARTICIPANT_UID, TEAM_ID, rosterTeam, seedOwnerConversation } from "./owner-read-test-support";
import { readParticipantConversation, type ReadParticipantConversationDeps } from "./read-participant-conversation";

/**
 * Participant visibility of owner-selected evidence (SPEC BR-46, BR-49, BR-72; SECURITY-REVIEW N-E3, D2-SI-8). Synthetic
 * fixtures only (invariant 15). Every denial is the same neutral `conversation_not_found`, and snapshots are kept, not deleted.
 */

const CONVERSATION_ID = "conv-1";
const TEAM_NAME = "Synthetic team";
const CAPTURED_AT = new Date("2026-10-10T08:00:00.000Z");

const EVIDENCE: SharedEvidenceSnapshot = {
  kind: "responsibility",
  title: "Synthetic responsibility",
  description: null,
  status: "active",
  relationToRole: "within",
  period: { start: "2026-01-01", end: null },
  capturedAt: CAPTURED_AT,
};

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  state: FakeTeamEligibilityState;
  deps: ReadParticipantConversationDeps;
}

function setup(): Setup {
  const store = createFakeConversationStore();
  const codec = createFakeContentCodec();
  const state = rosterTeam([OWNER_UID, PARTICIPANT_UID]);
  const deps: ReadParticipantConversationDeps = {
    store,
    codec,
    teamReader: createFakeTeamEligibilityReader(state),
    teamNameReader: { getTeamName: async () => TEAM_NAME },
    areaNameReader: { getSkillTree: async () => undefined },
    getNames: async (uids) => new Map(uids.filter((uid) => uid === OWNER_UID).map((uid) => [uid, "Synthetic owner"])),
  };
  return { store, codec, state, deps };
}

async function seedAcceptedWithEvidence(store: FakeConversationStore, codec: FakeContentCodec): Promise<void> {
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    participant: { uid: PARTICIPANT_UID, state: "accepted" },
    sharedEvidence: [EVIDENCE],
  });
  await store.runTransaction(async (tx) => {
    tx.setParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: new Date(NOW.getTime() + 1000) });
  });
}

const NOT_FOUND = { ok: false, error: "conversation_not_found" };

describe("accepted participant reads only the owner's selected snapshots (BR-46, BR-47)", () => {
  it("returns the stored evidence snapshot under sharedEvidence", async () => {
    const { store, codec, deps } = setup();
    await seedAcceptedWithEvidence(store, codec);

    const result = await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result.ok && result.dto.sharedEvidence).toEqual([EVIDENCE]);
  });

  it("returns no evidence when the owner has selected none (an empty list, never a missing key)", async () => {
    const { store, codec, deps } = setup();
    await seedOwnerConversation(store, codec, { conversationId: CONVERSATION_ID, participant: { uid: PARTICIPANT_UID, state: "accepted" } });
    await store.runTransaction(async (tx) => {
      tx.setParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: new Date(NOW.getTime() + 1000) });
    });

    const result = await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result.ok && result.dto.sharedEvidence).toEqual([]);
  });
});

describe("revocation hides evidence on the next read and keeps it stored (BR-49, BR-72, D2-SI-8)", () => {
  it("denies a removed participant with the neutral not-found result, with no evidence", async () => {
    const { store, codec, deps } = setup();
    await seedAcceptedWithEvidence(store, codec);
    await store.runTransaction(async (tx) => tx.deleteParticipation(PARTICIPANT_UID, CONVERSATION_ID));

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("denies a participant whose team is disabled, with no evidence", async () => {
    const { store, codec, state, deps } = setup();
    await seedAcceptedWithEvidence(store, codec);
    state.teamStatus[TEAM_ID] = "disabled";

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("keeps the snapshot stored for the owner after the participant is removed", async () => {
    const { store, codec, deps } = setup();
    await seedAcceptedWithEvidence(store, codec);
    await store.runTransaction(async (tx) => tx.deleteParticipation(PARTICIPANT_UID, CONVERSATION_ID));
    await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps);

    const raw = await store.getOwner(OWNER_UID, CONVERSATION_ID);
    expect(raw).toBeDefined();
    const decoded = raw ? codec.decodeContent({ ciphertext: raw.ciphertext, iv: raw.iv, authTag: raw.authTag, keyVersion: raw.keyVersion, keyCheck: raw.keyCheck } as never) : null;
    expect(decoded && decoded.ok && decoded.content.sharedEvidence).toEqual([EVIDENCE]);
  });
});

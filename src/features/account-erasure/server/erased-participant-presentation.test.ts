import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OWNER_PARTICIPANT_KEYS, OWNER_DTO_KEYS } from "../../development-conversations/domain/dto-keys";
import { createFakeConversationStore, type FakeConversationStore } from "../../development-conversations/server/fake-conversation-store";
import { createFakeContentCodec, type FakeContentCodec } from "../../development-conversations/server/fake-content-codec";
import { createFakeTeamEligibilityReader } from "../../development-conversations/server/fake-team-eligibility";
import {
  NOW,
  OWNER_UID,
  PARTICIPANT_MEMBER_REF,
  PARTICIPANT_UID,
  rosterTeam,
  seedOwnerConversation,
} from "../../development-conversations/server/owner-read-test-support";
import { readOwnerConversation, type ReadOwnerConversationDeps } from "../../development-conversations/server/read-owner-conversation";
import type { ConversationStore } from "../../development-conversations/server/conversation-store-types";
import { eraseParticipantBinding, type ParticipantBindingsDeps } from "./participant-bindings-erasure";
import { issueErasureOwnerCleanupCapability } from "../../development-conversations/server/erasure-owner-cleanup-capability";

// TASK-020: after a successful participant-binding cleanup (TASK-019), the owner's DTO shows the existing neutral
// no-participant state (`{ state: "none", displayName: null }`). No historical marker is persisted, so the owner DTO
// cannot tell an erased participant from a conversation that never had one. Fixtures are synthetic.

const CONVERSATION = "conv-presentation-1";
const GENUINE_EMPTY = "conv-presentation-empty";
const PARTICIPANT_NOTE = "Synthetic participant note that must not reappear";
const OWNER_NOTE = "Synthetic owner note kept";
const CAPTURED_AT = new Date("2026-10-10T08:00:00.000Z");
const TARGET = { ownerUid: OWNER_UID, conversationId: CONVERSATION };

function fake(): { store: FakeConversationStore; codec: FakeContentCodec } {
  return { store: createFakeConversationStore({ generateId: () => "unused" }), codec: createFakeContentCodec() };
}

function readDeps(store: ConversationStore, codec: FakeContentCodec): ReadOwnerConversationDeps {
  return {
    store,
    codec,
    teamReader: createFakeTeamEligibilityReader(rosterTeam([OWNER_UID, PARTICIPANT_UID])),
    resolveParticipantState: async () => true,
    getNames: async () => new Map([[PARTICIPANT_UID, "Synthetic Colleague"]]),
    areaNameReader: { async getSkillTree() { return undefined; } },
  };
}

function erasureDeps(store: ConversationStore, codec: FakeContentCodec): ParticipantBindingsDeps {
  return {
    store,
    codec,
    cleanupCapability: issueErasureOwnerCleanupCapability(),
    discovery: { async listBoundTo() { return []; } },
    clock: () => new Date(NOW.getTime()),
  };
}

async function seedBoundConversation(store: FakeConversationStore, codec: FakeContentCodec, status: "open" | "completed" = "open") {
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION,
    title: "Synthetic title",
    ownerNotes: OWNER_NOTE,
    nextSteps: ["Synthetic next step"],
    participantNotes: PARTICIPANT_NOTE,
    sharedGoals: [{ goalTitle: "Synthetic goal", treeId: null, targetDate: null, status: "active", capturedAt: CAPTURED_AT }],
    participant: { uid: PARTICIPANT_UID, state: "accepted" },
    status,
  });
  store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION, { ownerUid: OWNER_UID, invitedAt: NOW });
}

async function seedGenuineEmpty(store: FakeConversationStore, codec: FakeContentCodec) {
  await seedOwnerConversation(store, codec, {
    conversationId: GENUINE_EMPTY,
    title: "Synthetic title",
    ownerNotes: OWNER_NOTE,
    nextSteps: ["Synthetic next step"],
    sharedGoals: [{ goalTitle: "Synthetic goal", treeId: null, targetDate: null, status: "active", capturedAt: CAPTURED_AT }],
  });
}

async function readOwner(store: ConversationStore, codec: FakeContentCodec, conversationId: string) {
  const result = await readOwnerConversation(OWNER_UID, conversationId, readDeps(store, codec));
  if (!result.ok) throw new Error(`owner read failed: ${result.error}`);
  return result.conversation;
}

describe("neutral presentation after account erasure (TASK-020)", () => {
  it("shows the existing no-participant state with no display name after the erased participant's binding is cleaned", async () => {
    const { store, codec } = fake();
    await seedBoundConversation(store, codec);

    expect(await eraseParticipantBinding(erasureDeps(store, codec), TARGET, PARTICIPANT_UID)).toEqual({ ok: true, outcome: "cleaned" });
    const dto = await readOwner(store, codec, CONVERSATION);

    expect(dto.participant).toEqual({ state: "none", displayName: null });
    expect(Object.keys(dto.participant).sort()).toEqual([...OWNER_PARTICIPANT_KEYS].sort());
    expect(Object.keys(dto).sort()).toEqual([...OWNER_DTO_KEYS].sort());
  });

  it("leaks no erased uid, memberRef, notes text, or invitation timestamp in the owner DTO", async () => {
    const { store, codec } = fake();
    await seedBoundConversation(store, codec);
    await eraseParticipantBinding(erasureDeps(store, codec), TARGET, PARTICIPANT_UID);

    const serialized = JSON.stringify(await readOwner(store, codec, CONVERSATION));

    expect(serialized).not.toContain(PARTICIPANT_UID);
    expect(serialized).not.toContain(PARTICIPANT_MEMBER_REF);
    expect(serialized).not.toContain(PARTICIPANT_NOTE);
    expect(serialized).not.toContain("Synthetic Colleague");
    expect(serialized).not.toContain("invitedAt");
    expect(serialized).not.toContain("acceptedAt");
  });

  it("does not show the participant's notes again", async () => {
    const { store, codec } = fake();
    await seedBoundConversation(store, codec);
    await eraseParticipantBinding(erasureDeps(store, codec), TARGET, PARTICIPANT_UID);

    expect((await readOwner(store, codec, CONVERSATION)).participantNotes).toBe("");
  });

  it("keeps the owner's content visible after the cleanup", async () => {
    const { store, codec } = fake();
    await seedBoundConversation(store, codec);
    await eraseParticipantBinding(erasureDeps(store, codec), TARGET, PARTICIPANT_UID);

    const dto = await readOwner(store, codec, CONVERSATION);

    expect(dto).toMatchObject({
      title: "Synthetic title",
      ownerNotes: OWNER_NOTE,
      nextSteps: ["Synthetic next step"],
      status: "open",
      completedAt: null,
    });
    expect(dto.sharedGoals).toEqual([
      expect.objectContaining({ goalTitle: "Synthetic goal", areaName: null, status: "active" }),
    ]);
  });

  it("keeps a completed conversation readable by the owner, with its completed status intact", async () => {
    const { store, codec } = fake();
    await seedBoundConversation(store, codec, "completed");
    await eraseParticipantBinding(erasureDeps(store, codec), TARGET, PARTICIPANT_UID);

    const dto = await readOwner(store, codec, CONVERSATION);

    expect(dto.status).toBe("completed");
    expect(dto.ownerNotes).toBe(OWNER_NOTE);
    expect(dto.participant).toEqual({ state: "none", displayName: null });
  });

  it("gives an erased-participant conversation the same participant block as a genuine no-participant conversation", async () => {
    const { store, codec } = fake();
    await seedBoundConversation(store, codec);
    await seedGenuineEmpty(store, codec);
    await eraseParticipantBinding(erasureDeps(store, codec), TARGET, PARTICIPANT_UID);

    const erased = await readOwner(store, codec, CONVERSATION);
    const genuine = await readOwner(store, codec, GENUINE_EMPTY);

    expect(erased.participant).toEqual(genuine.participant);
  });

  it("persists no historical marker: the erased owner document has the same key set as a genuine no-participant document", async () => {
    const { store, codec } = fake();
    await seedBoundConversation(store, codec);
    await seedGenuineEmpty(store, codec);
    await eraseParticipantBinding(erasureDeps(store, codec), TARGET, PARTICIPANT_UID);

    const erasedRaw = await store.getOwner(OWNER_UID, CONVERSATION);
    const genuineRaw = await store.getOwner(OWNER_UID, GENUINE_EMPTY);
    if (erasedRaw === undefined || genuineRaw === undefined) throw new Error("owner document missing");

    expect(Object.keys(erasedRaw).sort()).toEqual(Object.keys(genuineRaw).sort());
    expect(erasedRaw).toMatchObject({
      participantUid: null,
      participantMemberRef: null,
      participantState: null,
      participantInvitedAt: null,
      participantAcceptedAt: null,
    });
  });

  it("removes the erased participant's index entry, so nothing is reachable for them afterwards", async () => {
    const { store, codec } = fake();
    await seedBoundConversation(store, codec);
    await eraseParticipantBinding(erasureDeps(store, codec), TARGET, PARTICIPANT_UID);

    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION)).toBeUndefined();
  });
});

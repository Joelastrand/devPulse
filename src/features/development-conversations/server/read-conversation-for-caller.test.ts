import { describe, expect, it, vi } from "vitest";
import { PARTICIPANT_DTO_KEYS, OWNER_DTO_KEYS, PENDING_DTO_KEYS } from "../domain/dto-keys";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import type { SkillTreeNameReader } from "./area-names";
import type { ConversationStore } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { readConversationForCaller, type ReadConversationForCallerDeps } from "./read-conversation-for-caller";
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
import { createProductionParticipantStateResolver } from "./owner-participant-state";

// Synthetic fixtures only (invariant 15). No real person, team or wellbeing data.
const CONVERSATION_ID = "conv-1";
const REJOINED_REF = "abcdefghjkmnpqrstvwxyz0123";
const TEAM_NAME = "Synthetic team";
const OWNER_NAME = "Synthetic owner";
const OUTSIDER_UID = "outsider-1";
const CAPTURED_AT = new Date("2026-10-10T08:00:00.000Z");

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  state: FakeTeamEligibilityState;
  deps: ReadConversationForCallerDeps;
  teamName: { value: unknown };
}

function setup(options: { members?: string[]; trees?: Record<string, string> } = {}): Setup {
  const store = createFakeConversationStore();
  const codec = createFakeContentCodec();
  const state = rosterTeam(options.members ?? [OWNER_UID, PARTICIPANT_UID]);
  const teamReader = createFakeTeamEligibilityReader(state);
  const teamName = { value: TEAM_NAME as unknown };
  const teamNameReader = { getTeamName: async () => teamName.value };
  const trees = options.trees ?? { "tree-a": "Synthetic area" };
  const areaNameReader: SkillTreeNameReader = {
    getSkillTree: async (treeId) =>
      trees[treeId] === undefined
        ? undefined
        : {
            name: trees[treeId],
            nodes: [{ nodeId: "node-0", label: "Start", order: 0 }],
            createdAt: new Date("2026-08-01T08:00:00.000Z"),
            createdBy: "admin-1",
          },
  };
  const getNames = async (uids: readonly string[]) => new Map(uids.filter((uid) => uid === OWNER_UID).map((uid) => [uid, OWNER_NAME]));
  const deps: ReadConversationForCallerDeps = {
    store,
    owner: {
      store,
      codec,
      teamReader,
      resolveParticipantState: createProductionParticipantStateResolver(store),
      areaNameReader,
      getNames,
    },
    participant: { store, codec, teamReader, teamNameReader, areaNameReader, getNames },
    pending: { store, teamReader, teamNameReader, getNames },
  };
  return { store, codec, state, deps, teamName };
}

function goal(treeId: string | null, goalTitle = "Synthetic goal"): SharedGoalSnapshot {
  return { goalTitle, treeId, targetDate: null, status: "active", capturedAt: CAPTURED_AT };
}

async function seedIndex(store: ConversationStore, callerUid: string, ownerUid = OWNER_UID): Promise<void> {
  await store.runTransaction(async (tx) => {
    tx.setParticipation(callerUid, CONVERSATION_ID, { ownerUid, invitedAt: new Date(NOW.getTime() + 1000) });
  });
}

async function seedWithParticipant(store: FakeConversationStore, codec: FakeContentCodec, state: "pending" | "accepted"): Promise<void> {
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    title: "Synthetic title",
    ownerNotes: "Synthetic owner note",
    nextSteps: ["Synthetic next step"],
    participantNotes: "Synthetic participant note",
    plannedFor: "2026-11-01",
    sharedGoals: [goal("tree-a", "Synthetic goal A")],
    participant: { uid: PARTICIPANT_UID, state },
  });
  await seedIndex(store, PARTICIPANT_UID);
}

describe("readConversationForCaller: the owner view (SPEC BR-35)", () => {
  it("returns the owner view for the owner of the document, and never the participant views", async () => {
    const { store, codec, deps } = setup();
    await seedWithParticipant(store, codec, "accepted");

    const result = await readConversationForCaller(OWNER_UID, CONVERSATION_ID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.kind).toBe("owner");
    if (result.view.kind !== "owner") return;
    expect(Object.keys(result.view.dto).sort()).toEqual([...OWNER_DTO_KEYS].sort());
    expect(result.view.dto.participantNotes).toBe("Synthetic participant note");
  });

  it("reports a key outage on the owner's own document as persistence_failed, never as the participant or pending view", async () => {
    const { store, codec, deps } = setup();
    await seedWithParticipant(store, codec, "accepted");
    codec.setKeyFailure("key_unavailable");

    expect(await readConversationForCaller(OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });
});

describe("readConversationForCaller: the accepted participant view (SPEC BR-21, BR-22, BR-43)", () => {
  it("returns the participant view with the caller's own notes and the current owner content", async () => {
    const { store, codec, deps } = setup();
    await seedWithParticipant(store, codec, "accepted");

    const result = await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.kind).toBe("participant");
    expect(Object.keys(result.view.dto).sort()).toEqual([...PARTICIPANT_DTO_KEYS].sort());
    expect(result.view.dto).toMatchObject({
      title: "Synthetic title",
      ownerNotes: "Synthetic owner note",
      participantNotes: "Synthetic participant note",
      teamName: TEAM_NAME,
      ownerDisplayName: OWNER_NAME,
    });
  });

  it("fails an accepted participant whose membership has a stale memberRef as conversation_not_found, never a pending view", async () => {
    const { store, codec, state, deps } = setup();
    await seedWithParticipant(store, codec, "accepted");
    state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = { uid: PARTICIPANT_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: REJOINED_REF };

    expect(await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("reports an operational team-name failure as persistence_failed, not as the pending view", async () => {
    const { store, codec, teamName, deps } = setup();
    await seedWithParticipant(store, codec, "accepted");
    teamName.value = undefined;

    expect(await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("reports a key outage for an accepted participant as persistence_failed, with no participant content", async () => {
    const { store, codec, deps } = setup();
    await seedWithParticipant(store, codec, "accepted");
    codec.setKeyFailure("key_unavailable");

    const result = await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("Synthetic participant note");
  });
});

describe("readConversationForCaller: the pending invitee view (SPEC BR-14, BR-41)", () => {
  it("returns the pending view with exactly the pending keys and no content", async () => {
    const { store, codec, deps } = setup();
    await seedWithParticipant(store, codec, "pending");

    const result = await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.kind).toBe("pending");
    expect(Object.keys(result.view.dto).sort()).toEqual([...PENDING_DTO_KEYS].sort());
    const text = JSON.stringify(result.view.dto);
    for (const content of ["Synthetic title", "Synthetic owner note", "Synthetic next step", "Synthetic goal A", "2026-11-01", "Synthetic participant note"]) {
      expect(text).not.toContain(content);
    }
  });

  it("returns the pending view while the key is unavailable, and never probes or decrypts the key (BR-53)", async () => {
    const { store, codec, deps } = setup();
    await seedWithParticipant(store, codec, "pending");
    codec.setKeyFailure("key_unavailable");
    const probe = vi.spyOn(codec, "probeKey");
    const decrypt = vi.spyOn(codec, "decryptForClassification");

    const result = await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, deps);

    expect(result.ok && result.view.kind).toBe("pending");
    expect(probe).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("denies a pending invitee whose membership has a stale memberRef as conversation_not_found (CL-23)", async () => {
    const { store, codec, state, deps } = setup();
    await seedWithParticipant(store, codec, "pending");
    state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = { uid: PARTICIPANT_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: REJOINED_REF };

    expect(await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("reports an operational failure of the pending path as persistence_failed, never as an invitation that is gone", async () => {
    const { store, codec, state, deps } = setup();
    await seedWithParticipant(store, codec, "pending");
    const failing = { ...deps, pending: { ...deps.pending, teamNameReader: { getTeamName: async () => undefined } } };
    state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = { uid: PARTICIPANT_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: PARTICIPANT_MEMBER_REF };

    expect(await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, failing)).toEqual({ ok: false, error: "persistence_failed" });
  });
});

describe("readConversationForCaller: denial is uniform (BR-14, BR-21, BR-35, D2-SI-15)", () => {
  it("answers an unrelated caller, a missing id and a malformed id with conversation_not_found", async () => {
    const { store, codec, deps } = setup({ members: [OWNER_UID, PARTICIPANT_UID, OUTSIDER_UID] });
    await seedWithParticipant(store, codec, "accepted");

    expect(await readConversationForCaller(OUTSIDER_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await readConversationForCaller(PARTICIPANT_UID, "missing-id", deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(await readConversationForCaller(PARTICIPANT_UID, "bad/id", deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("answers a removed participant, whose index is gone, with conversation_not_found", async () => {
    const { store, codec, deps } = setup();
    await seedWithParticipant(store, codec, "accepted");
    await store.runTransaction(async (tx) => {
      tx.deleteParticipation(PARTICIPANT_UID, CONVERSATION_ID);
    });

    expect(await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("answers another owner, who holds only a different conversation, with conversation_not_found for this id", async () => {
    const { store, codec, deps } = setup({ members: [OWNER_UID, PARTICIPANT_UID, OTHER_OWNER_UID] });
    await seedWithParticipant(store, codec, "accepted");
    await seedOwnerConversation(store, codec, { ownerUid: OTHER_OWNER_UID, conversationId: "conv-2", title: "Other" });

    expect(await readConversationForCaller(OTHER_OWNER_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("maps an unexpected store failure to persistence_failed with no raw text", async () => {
    const { deps } = setup();
    const failingStore = {
      ...deps.store,
      getOwner: async () => {
        throw new Error("simulated firestore failure at a secret path");
      },
    } as unknown as ConversationStore;

    const result = await readConversationForCaller(PARTICIPANT_UID, CONVERSATION_ID, { ...deps, store: failingStore });
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret path");
  });
});

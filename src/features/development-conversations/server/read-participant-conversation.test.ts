import { describe, expect, it } from "vitest";
import { PARTICIPANT_DTO_KEYS } from "../domain/dto-keys";
import type { SharedGoalSnapshot } from "../domain/shared-goal-snapshot";
import type { SkillTreeNameReader } from "./area-names";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import {
  NOW,
  OWNER_UID,
  PARTICIPANT_MEMBER_REF,
  PARTICIPANT_UID,
  TEAM_ID,
  rosterTeam,
  seedOwnerConversation,
} from "./owner-read-test-support";
import { readParticipantConversation, type ReadParticipantConversationDeps } from "./read-participant-conversation";
import type { TeamNameReader } from "./read-pending-invitation";

// Synthetic fixtures only (invariant 15). No real person, team or wellbeing data.
const CONVERSATION_ID = "conv-1";
const OTHER_PARTICIPANT_UID = "participant-2";
const REJOINED_REF = "abcdefghjkmnpqrstvwxyz0123";
const TEAM_NAME = "Synthetic team";
const OWNER_NAME = "Synthetic owner";
const CAPTURED_AT = new Date("2026-10-10T08:00:00.000Z");

interface Setup {
  store: FakeConversationStore;
  codec: FakeContentCodec;
  state: FakeTeamEligibilityState;
  deps: ReadParticipantConversationDeps;
}

function setup(
  options: { members?: string[]; failTeamNameRead?: boolean; teamName?: unknown; trees?: Record<string, string> } = {},
): Setup {
  const store = createFakeConversationStore();
  const codec = createFakeContentCodec();
  const state = rosterTeam(options.members ?? [OWNER_UID, PARTICIPANT_UID]);
  const teamReader = createFakeTeamEligibilityReader(state);
  const teamNameReader: TeamNameReader = {
    getTeamName: async () => {
      if (options.failTeamNameRead) throw new Error("simulated team name failure");
      return "teamName" in options ? options.teamName : TEAM_NAME;
    },
  };
  const trees = options.trees ?? { "tree-a": "Synthetic area" };
  const areaNameReader: SkillTreeNameReader = {
    getSkillTree: async (treeId) =>
      trees[treeId] === undefined
        ? undefined
        : {
            name: trees[treeId],
            nodes: [
              { nodeId: "node-0", label: "Start", order: 0 },
              { nodeId: "node-1", label: "Mål", order: 1 },
            ],
            createdAt: new Date("2026-08-01T08:00:00.000Z"),
            createdBy: "admin-1",
          },
  };
  const deps: ReadParticipantConversationDeps = {
    store,
    codec,
    teamReader,
    teamNameReader,
    areaNameReader,
    getNames: async (uids) => new Map(uids.filter((uid) => uid === OWNER_UID).map((uid) => [uid, OWNER_NAME])),
  };
  return { store, codec, state, deps };
}

function goal(treeId: string | null, goalTitle = "Synthetic goal"): SharedGoalSnapshot {
  return { goalTitle, treeId, targetDate: null, status: "active", capturedAt: CAPTURED_AT };
}

/** An accepted participant of `CONVERSATION_ID`: owner document plus the caller's index entry. */
async function seedAccepted(store: FakeConversationStore, codec: FakeContentCodec, extra: Partial<Parameters<typeof seedOwnerConversation>[2]> = {}) {
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    title: "Synthetic title",
    ownerNotes: "Synthetic owner note",
    nextSteps: ["Synthetic next step"],
    participantNotes: "Synthetic participant note",
    plannedFor: "2026-11-01",
    sharedGoals: [goal("tree-a", "Synthetic goal A")],
    participant: { uid: PARTICIPANT_UID, state: "accepted" },
    ...extra,
  });
  await seedIndex(store, PARTICIPANT_UID);
}

async function seedIndex(store: FakeConversationStore, callerUid: string, ownerUid = OWNER_UID): Promise<void> {
  await store.runTransaction(async (tx) => {
    tx.setParticipation(callerUid, CONVERSATION_ID, { ownerUid, invitedAt: new Date(NOW.getTime() + 1000) });
  });
}

const NOT_FOUND = { ok: false, error: "conversation_not_found" };

describe("readParticipantConversation: accepted participant detail (BR-22, BR-43, D2-SI-6)", () => {
  it("returns the participant DTO with the exact key set and every section", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);

    const result = await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.dto).sort()).toEqual([...PARTICIPANT_DTO_KEYS].sort());
    expect(result.dto).toMatchObject({
      conversationId: CONVERSATION_ID,
      title: "Synthetic title",
      status: "open",
      plannedFor: "2026-11-01",
      teamName: TEAM_NAME,
      ownerDisplayName: OWNER_NAME,
      ownerNotes: "Synthetic owner note",
      nextSteps: ["Synthetic next step"],
      participantNotes: "Synthetic participant note",
      completedAt: null,
    });
    expect(result.dto.sharedGoals).toEqual([
      { goalTitle: "Synthetic goal A", areaName: "Synthetic area", targetDate: null, status: "active", capturedAt: CAPTURED_AT },
    ]);
  });

  it("returns no owner uid, participant uid, memberRef, e-mail or membership id", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);

    const serialized = JSON.stringify(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps));
    for (const forbidden of [OWNER_UID, PARTICIPANT_UID, PARTICIPANT_MEMBER_REF, "@", `${PARTICIPANT_UID}__${TEAM_ID}`]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("shows a null owner name when the owner no longer holds an active membership (the roster rule)", async () => {
    const { store, codec, state, deps } = setup();
    await seedAccepted(store, codec);
    delete state.memberships[`${OWNER_UID}__${TEAM_ID}`];

    const result = await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result.ok && result.dto.ownerDisplayName).toBe(null);
  });
});

describe("readParticipantConversation: each BR-21 condition alone (BR-21, D2-SI-15)", () => {
  it("denies a caller with no index entry", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    await store.runTransaction(async (tx) => tx.deleteParticipation(PARTICIPANT_UID, CONVERSATION_ID));

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("denies an index entry without an ownerUid", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { invitedAt: NOW });

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("denies when the owner document is missing", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    await store.runTransaction(async (tx) => tx.deleteOwner(OWNER_UID, CONVERSATION_ID));

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("denies when the owner document names a different participant", async () => {
    const { store, codec, state, deps } = setup({ members: [OWNER_UID, PARTICIPANT_UID, OTHER_PARTICIPANT_UID] });
    await seedAccepted(store, codec, { participant: { uid: OTHER_PARTICIPANT_UID, state: "accepted" } });
    state.memberships[`${OTHER_PARTICIPANT_UID}__${TEAM_ID}`] = { uid: OTHER_PARTICIPANT_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: PARTICIPANT_MEMBER_REF };

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("denies a pending participant on the content path", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec, { participant: { uid: PARTICIPANT_UID, state: "pending" } });

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("denies when the team is disabled", async () => {
    const { store, codec, state, deps } = setup();
    await seedAccepted(store, codec);
    state.teamStatus[TEAM_ID] = "disabled";

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("denies when the caller's membership is missing", async () => {
    const { store, codec, state, deps } = setup();
    await seedAccepted(store, codec);
    delete state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("allows a lead as an ordinary member; the role is not an input", async () => {
    const { store, codec, state, deps } = setup();
    await seedAccepted(store, codec);
    state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = {
      uid: PARTICIPANT_UID,
      teamId: TEAM_ID,
      createdAt: new Date(0),
      memberRef: PARTICIPANT_MEMBER_REF,
      role: "lead",
    };

    const result = await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result.ok).toBe(true);
  });

  it("denies a rejoined member whose membership carries a new memberRef", async () => {
    const { store, codec, state, deps } = setup();
    await seedAccepted(store, codec);
    state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = { uid: PARTICIPANT_UID, teamId: TEAM_ID, createdAt: new Date(0), memberRef: REJOINED_REF };

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });
});

describe("readParticipantConversation: failures (BR-47, BR-53, BR-21)", () => {
  it("reports a membership read failure as persistence_failed, never as not found", async () => {
    const { store, codec, state, deps } = setup();
    await seedAccepted(store, codec);
    const teamStatus = createFakeTeamEligibilityReader(state);
    deps.teamReader = {
      getTeamStatus: teamStatus.getTeamStatus,
      getMembership: async () => {
        throw new Error("simulated membership read failure with a secret path");
      },
    };

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
  });

  it("reports a key outage as persistence_failed, not as not found", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    codec.setKeyFailure("key_unavailable");

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
  });

  it("reports a key mismatch as persistence_failed, not as an unreadable payload", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    codec.setKeyFailure("key_mismatch");

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
  });

  it("returns not found for a malformed decrypted payload", async () => {
    const { store, codec, deps } = setup();
    // A 101-code-point title is over TASK-001's limit, so the decrypted payload breaks the content rules.
    await seedAccepted(store, codec, { title: "a".repeat(101) });

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("returns not found for an unauthenticated payload", async () => {
    const { store, codec, deps } = setup();
    await seedAccepted(store, codec);
    const record = { ...(await store.getOwner(OWNER_UID, CONVERSATION_ID)) };
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...record, ciphertext: Buffer.from("not-stored", "utf8").toString("base64") });

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("returns persistence_failed when the team name is missing (team data, not conversation data)", async () => {
    const { store, codec, deps } = setup({ teamName: undefined });
    await seedAccepted(store, codec);

    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({
      ok: false,
      error: "persistence_failed",
    });
  });
});

describe("readParticipantConversation: lifecycle (BR-30, BR-31, BR-32, D2-SI-10)", () => {
  it("restores access after the team is re-enabled with the same binding", async () => {
    const { store, codec, state, deps } = setup();
    await seedAccepted(store, codec);
    state.teamStatus[TEAM_ID] = "disabled";
    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);

    state.teamStatus[TEAM_ID] = "active";
    expect((await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).ok).toBe(true);
  });

  it("keeps participant access when the owner leaves the team (owner membership is not checked)", async () => {
    const { store, codec, state, deps } = setup();
    await seedAccepted(store, codec);
    delete state.memberships[`${OWNER_UID}__${TEAM_ID}`];

    const result = await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result.ok).toBe(true);
  });

  it("reads a completed conversation while eligible, and denies it after removal from the team", async () => {
    const { store, codec, state, deps } = setup();
    await seedAccepted(store, codec, { status: "completed" });

    const completed = await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(completed.ok && completed.dto.status).toBe("completed");

    delete state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];
    expect(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual(NOT_FOUND);
  });

  it("returns an identical body for every denial", async () => {
    const { store, codec, state, deps } = setup();
    await seedAccepted(store, codec);
    const denials: unknown[] = [];

    await store.runTransaction(async (tx) => tx.deleteParticipation(PARTICIPANT_UID, CONVERSATION_ID));
    denials.push(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps));
    await seedIndex(store, PARTICIPANT_UID, "owner-missing");
    denials.push(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps));
    state.teamStatus[TEAM_ID] = "disabled";
    await seedIndex(store, PARTICIPANT_UID);
    denials.push(await readParticipantConversation(PARTICIPANT_UID, CONVERSATION_ID, deps));

    for (const denial of denials) {
      expect(denial).toStrictEqual(NOT_FOUND);
    }
  });
});

import { describe, expect, it } from "vitest";
import type { ConversationStore } from "./conversation-store-types";
import { createFakeConversationStore, type FakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { createFakeContentCodec } from "./fake-content-codec";
import { readPendingInvitation, type PendingInvitationDeps } from "./read-pending-invitation";
import {
  NOW,
  OTHER_OWNER_UID,
  OWNER_UID,
  PARTICIPANT_MEMBER_REF,
  PARTICIPANT_UID,
  TEAM_ID,
  seedOwnerConversation,
} from "./owner-read-test-support";

// Synthetic fixtures only (invariant 15). No real person, team or wellbeing data.
const CONVERSATION_ID = "conv-1";
const OTHER_UID = "participant-2";
const OWNER_REF = "zyxwvtsrqpnmkjhgfedcba9876";
const REJOINED_REF = "abcdefghjkmnpqrstvwxyz0123";
const TEAM_NAME = "Synthetic team";
const OWNER_NAME = "Synthetic owner";

interface Setup {
  store: FakeConversationStore;
  state: FakeTeamEligibilityState;
  deps: PendingInvitationDeps;
  nameReads: string[];
}

function membership(uid: string, memberRef: string, teamId = TEAM_ID): Record<string, unknown> {
  return { uid, teamId, createdAt: new Date(0), memberRef };
}

function setup(
  options: { failTeamNameRead?: boolean; failTeamRead?: boolean; failNames?: boolean; teamName?: unknown; names?: boolean } = {},
): Setup {
  const store = createFakeConversationStore();
  const state: FakeTeamEligibilityState = {
    teamStatus: { [TEAM_ID]: "active" },
    memberships: {
      [`${OWNER_UID}__${TEAM_ID}`]: membership(OWNER_UID, OWNER_REF),
      [`${PARTICIPANT_UID}__${TEAM_ID}`]: membership(PARTICIPANT_UID, PARTICIPANT_MEMBER_REF),
    },
  };
  const point = createFakeTeamEligibilityReader(state);
  const nameReads: string[] = [];
  const deps: PendingInvitationDeps = {
    store,
    teamReader: {
      getTeamStatus: async (teamId) => {
        if (options.failTeamRead) throw new Error("simulated team read failure");
        return point.getTeamStatus(teamId);
      },
      getMembership: point.getMembership,
    },
    teamNameReader: {
      getTeamName: async (teamId) => {
        nameReads.push(teamId);
        if (options.failTeamNameRead) throw new Error("simulated name read failure with a secret path");
        return "teamName" in options ? options.teamName : TEAM_NAME;
      },
    },
    getNames: async (uids) => {
      if (options.failNames) throw new Error("simulated profile failure with a secret path");
      if (options.names === false) return new Map();
      return new Map(uids.filter((uid) => uid === OWNER_UID).map((uid) => [uid, OWNER_NAME]));
    },
  };
  return { store, state, deps, nameReads };
}

/** Writes the caller's canonical participation index, as the invitation transaction does. */
async function seedIndex(store: ConversationStore, callerUid: string, ownerUid = OWNER_UID): Promise<void> {
  await store.runTransaction(async (tx) => {
    tx.setParticipation(callerUid, CONVERSATION_ID, { ownerUid, invitedAt: new Date(NOW.getTime() + 1000) });
  });
}

/** A pending invitation for the caller: owner document plus index. Owner notes and a date are set to prove they stay hidden. */
async function seedPendingInvitation(store: FakeConversationStore, codec = createFakeContentCodec()): Promise<void> {
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    title: "Synthetic title, hidden until acceptance",
    ownerNotes: "Synthetic owner note, hidden until acceptance",
    nextSteps: ["Synthetic next step"],
    plannedFor: "2026-11-03",
    participant: { uid: PARTICIPANT_UID, state: "pending" },
  });
  await seedIndex(store, PARTICIPANT_UID);
}

describe("readPendingInvitation: pending DTO (BR-14, BR-41, CL-19)", () => {
  it("returns exactly the BR-41 key set with the expected values", async () => {
    const { store, deps } = setup();
    await seedPendingInvitation(store);

    const result = await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps);

    expect(result).toEqual({
      ok: true,
      dto: {
        conversationId: CONVERSATION_ID,
        state: "pending",
        teamName: TEAM_NAME,
        invitedAt: new Date(NOW.getTime() + 1000),
        ownerDisplayName: OWNER_NAME,
      },
    });
  });

  it("returns no title, note, step, date, goal, owner uid, caller uid or memberRef", async () => {
    const { store, deps } = setup();
    await seedPendingInvitation(store);

    const serialized = JSON.stringify(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps));
    for (const forbidden of [
      "Synthetic title",
      "Synthetic owner note",
      "Synthetic next step",
      "2026-11-03",
      OWNER_UID,
      PARTICIPANT_UID,
      PARTICIPANT_MEMBER_REF,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns a null owner name when the owner no longer holds an active membership (the roster rule)", async () => {
    const { store, state, deps } = setup();
    await seedPendingInvitation(store);
    delete state.memberships[`${OWNER_UID}__${TEAM_ID}`];

    const result = await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result.ok && result.dto.ownerDisplayName).toBeNull();
  });

  it("does not decrypt: the pending view works when the stored payload is unreadable", async () => {
    const { store, deps } = setup();
    await seedPendingInvitation(store);
    const raw = await store.getOwner(OWNER_UID, CONVERSATION_ID);
    if (raw === undefined) throw new Error("fixture missing");
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, ciphertext: Buffer.from("no-such-handle").toString("base64") });

    const result = await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result.ok).toBe(true);
  });
});

describe("readPendingInvitation: not-found family (BR-14, D2-SI-15)", () => {
  it("returns conversation_not_found for a malformed id before any read", async () => {
    const { deps, nameReads } = setup();
    expect(await readPendingInvitation(PARTICIPANT_UID, "bad id!", deps)).toEqual({ ok: false, error: "conversation_not_found" });
    expect(nameReads).toHaveLength(0);
  });

  it("returns conversation_not_found when the caller has no index entry", async () => {
    const { store, deps } = setup();
    await seedOwnerConversation(store, createFakeContentCodec(), {
      conversationId: CONVERSATION_ID,
      participant: { uid: PARTICIPANT_UID, state: "pending" },
    });
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found for a malformed index entry", async () => {
    const { store, deps } = setup();
    await seedPendingInvitation(store);
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: "not a date" });
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found for a stale index whose owner has no such conversation", async () => {
    const { store, deps } = setup();
    await seedPendingInvitation(store);
    await seedIndex(store, PARTICIPANT_UID, OTHER_OWNER_UID);
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found for an index whose owner uid is not a valid path segment", async () => {
    const { store, deps } = setup();
    await seedPendingInvitation(store);
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: "../escape", invitedAt: NOW });
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found when the document names a different participant", async () => {
    const { store, deps } = setup();
    await seedOwnerConversation(store, createFakeContentCodec(), {
      conversationId: CONVERSATION_ID,
      participant: { uid: OTHER_UID, state: "pending" },
    });
    await seedIndex(store, PARTICIPANT_UID);
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found for an accepted participant, since the pending view is for pending only", async () => {
    const { store, deps } = setup();
    await seedOwnerConversation(store, createFakeContentCodec(), {
      conversationId: CONVERSATION_ID,
      participant: { uid: PARTICIPANT_UID, state: "accepted" },
    });
    await seedIndex(store, PARTICIPANT_UID);
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found for a malformed owner document", async () => {
    const { store, deps } = setup();
    await seedPendingInvitation(store);
    const raw = await store.getOwner(OWNER_UID, CONVERSATION_ID);
    if (raw === undefined) throw new Error("fixture missing");
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, status: "archived" });
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found when the caller's membership has been removed", async () => {
    const { store, state, deps } = setup();
    await seedPendingInvitation(store);
    delete state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`];
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found when the team is inactive", async () => {
    const { store, state, deps } = setup();
    await seedPendingInvitation(store);
    state.teamStatus[TEAM_ID] = "disabled";
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found after the caller rejoined with a new memberRef (old binding is dead, CL-23)", async () => {
    const { store, state, deps } = setup();
    await seedPendingInvitation(store);
    state.memberships[`${PARTICIPANT_UID}__${TEAM_ID}`] = membership(PARTICIPANT_UID, REJOINED_REF);
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });
});

describe("readPendingInvitation: operational failures are never not-found", () => {
  it("returns persistence_failed when the caller's team read fails", async () => {
    const { store, deps } = setup({ failTeamRead: true });
    await seedPendingInvitation(store);
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("returns persistence_failed when the team name read fails, without leaking the raw error", async () => {
    const { store, deps } = setup({ failTeamNameRead: true });
    await seedPendingInvitation(store);
    const result = await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret path");
  });

  it("returns persistence_failed when the owner-name lookup fails, without leaking the raw error", async () => {
    const { store, deps } = setup({ failNames: true });
    await seedPendingInvitation(store);
    const result = await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result).toEqual({ ok: false, error: "persistence_failed" });
    expect(JSON.stringify(result)).not.toContain("secret path");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["a number", 42],
    ["an empty string", ""],
  ])("returns persistence_failed when the team name is %s, without distinguishing the cause", async (_label, teamName) => {
    const { store, deps } = setup({ teamName });
    await seedPendingInvitation(store);
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });
});

describe("readPendingInvitation: presentation rules (BR-41, CL-20)", () => {
  it("returns a null owner name and no uid, email or memberRef fallback when the owner has no profile name", async () => {
    const { store, deps } = setup({ names: false });
    await seedPendingInvitation(store);

    const result = await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result.ok && result.dto.ownerDisplayName).toBeNull();
    expect(JSON.stringify(result)).not.toContain(OWNER_UID);
    expect(JSON.stringify(result)).not.toContain(OWNER_REF);
  });

  it("takes invitedAt from the index, not from the owner document", async () => {
    const { store, deps } = setup();
    await seedPendingInvitation(store);
    const raw = await store.getOwner(OWNER_UID, CONVERSATION_ID);
    if (raw === undefined) throw new Error("fixture missing");
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, participantInvitedAt: new Date(NOW.getTime() + 999_000) });

    const result = await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result.ok && result.dto.invitedAt).toEqual(new Date(NOW.getTime() + 1000));
  });

  it("returns exactly the four BR-41 keys plus conversationId and state", async () => {
    const { store, deps } = setup();
    await seedPendingInvitation(store);

    const result = await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps);
    expect(result.ok && Object.keys(result.dto).sort()).toEqual(["conversationId", "invitedAt", "ownerDisplayName", "state", "teamName"]);
  });
});

describe("readPendingInvitation: stored-state binding and lifecycle", () => {
  it("returns conversation_not_found for a completed conversation that still names a pending participant (canonical parser rejects it, BR-13)", async () => {
    const { store, deps } = setup();
    await seedOwnerConversation(store, createFakeContentCodec(), {
      conversationId: CONVERSATION_ID,
      status: "completed",
      participant: { uid: PARTICIPANT_UID, state: "pending" },
    });
    await seedIndex(store, PARTICIPANT_UID);
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found when the stored memberRef is null or malformed", async () => {
    for (const badRef of [null, "short"]) {
      const { store, deps } = setup();
      await seedPendingInvitation(store);
      const raw = await store.getOwner(OWNER_UID, CONVERSATION_ID);
      if (raw === undefined) throw new Error("fixture missing");
      store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, participantMemberRef: badRef });
      expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
    }
  });

  it("returns conversation_not_found when the owner document is missing but the index exists", async () => {
    const { store, deps } = setup();
    await seedIndex(store, PARTICIPANT_UID);
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("returns conversation_not_found for a malformed index timestamp", async () => {
    const { store, deps } = setup();
    await seedPendingInvitation(store);
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: "2026-13-99" });
    expect(await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps)).toEqual({ ok: false, error: "conversation_not_found" });
  });

  it("performs no write and no repair of the owner document, the index or the team", async () => {
    const { store, state, deps } = setup();
    await seedPendingInvitation(store);
    const ownerBefore = await store.getOwner(OWNER_UID, CONVERSATION_ID);
    const indexBefore = await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID);
    const membershipsBefore = JSON.stringify(state.memberships);
    const ownerCountBefore = await store.countOwner(OWNER_UID);

    await readPendingInvitation(PARTICIPANT_UID, CONVERSATION_ID, deps);

    expect(await store.getOwner(OWNER_UID, CONVERSATION_ID)).toEqual(ownerBefore);
    expect(await store.getParticipation(PARTICIPANT_UID, CONVERSATION_ID)).toEqual(indexBefore);
    expect(JSON.stringify(state.memberships)).toBe(membershipsBefore);
    expect(await store.countOwner(OWNER_UID)).toBe(ownerCountBefore);
  });
});

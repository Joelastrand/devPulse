import { describe, expect, it } from "vitest";
import type { ConversationStore } from "./conversation-store-types";
import { createFakeContentCodec, type FakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { createProductionParticipantStateResolver } from "./owner-participant-state";
import { NOW, OWNER_UID, PARTICIPANT_UID, TEAM_ID, rosterTeam, seedOwnerConversation } from "./owner-read-test-support";
import { readOwnerConversation } from "./read-owner-conversation";
import { readOwnerConversations, type ReadOwnerConversationsDeps } from "./read-owner-conversations";

/**
 * TASK-023 I-2: the owner list and detail share one request memo of raw team and membership reads. These tests count the
 * reads that reach the store and the team reader, and prove the binding decision is still made per conversation.
 * Synthetic fixtures only.
 */

const TEAM_BETA = "team-beta";
/** The seeded participant's stored memberRef is `PARTICIPANT_MEMBER_REF`. This is a different, well-formed ref. */
const STALE_REF = "0123456789abcdefghjkmnpqrt";

function countedStore(base: ConversationStore) {
  const counts = { participation: 0, owner: 0 };
  const store: ConversationStore = {
    ...base,
    getParticipation: (callerUid, conversationId) => {
      counts.participation += 1;
      return base.getParticipation(callerUid, conversationId);
    },
    getOwner: (ownerUid, conversationId) => {
      counts.owner += 1;
      return base.getOwner(ownerUid, conversationId);
    },
  };
  return { store, counts };
}

function countedTeamReader(state: FakeTeamEligibilityState) {
  const base = createFakeTeamEligibilityReader(state);
  const counts = { teamStatus: new Map<string, number>(), membership: new Map<string, number>() };
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  return {
    counts,
    reader: {
      getTeamStatus: (teamId: string) => {
        bump(counts.teamStatus, teamId);
        return base.getTeamStatus(teamId);
      },
      getMembership: (uid: string, teamId: string) => {
        bump(counts.membership, `${uid}|${teamId}`);
        return base.getMembership(uid, teamId);
      },
    },
  };
}

async function setup(teams: FakeTeamEligibilityState) {
  const codec: FakeContentCodec = createFakeContentCodec();
  const base = createFakeConversationStore({ teams, generateId: () => "unused" });
  const counted = countedStore(base);
  const team = countedTeamReader(teams);
  const deps: ReadOwnerConversationsDeps = {
    store: counted.store,
    codec,
    teamReader: team.reader,
    resolveParticipantState: createProductionParticipantStateResolver(counted.store),
    getNames: async () => new Map(),
  };
  return { base, codec, deps, counted, team };
}

/** Seeds one conversation for the owner. Each conversation has its own participant binding and its own stored memberRef. */
async function seedBound(
  base: ConversationStore,
  codec: FakeContentCodec,
  conversationId: string,
  options: { participantUid?: string; teamId?: string; participantNotes?: string } = {},
) {
  await seedOwnerConversation(base, codec, {
    conversationId,
    teamId: options.teamId ?? TEAM_ID,
    participant: { uid: options.participantUid ?? PARTICIPANT_UID, state: "accepted" },
    participantNotes: options.participantNotes,
  });
  // The participant index is written separately, as TASK-014 does, so the BR-21 index check has a real entry to read.
  await base.runTransaction(async (tx) => {
    tx.setParticipation(options.participantUid ?? PARTICIPANT_UID, conversationId, { ownerUid: OWNER_UID, invitedAt: NOW });
  });
}

async function setStoredRef(base: ConversationStore, conversationId: string, ref: string) {
  await base.runTransaction(async (tx) => tx.updateOwner(OWNER_UID, conversationId, { participantMemberRef: ref }));
}

const participantStates = (items: Array<{ conversationId: string; participant: { state: string } }>) =>
  Object.fromEntries(items.map((item) => [item.conversationId, item.participant.state]));

describe("owner list request memo (TASK-023 I-2)", () => {
  it("reads each team status and each membership once across several items, while each item keeps its own binding", async () => {
    const { base, codec, deps, counted, team } = await setup(rosterTeam([OWNER_UID, PARTICIPANT_UID]));
    for (const id of ["conv-1", "conv-2", "conv-3"]) await seedBound(base, codec, id);

    const result = await readOwnerConversations(OWNER_UID, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(participantStates(result.conversations)).toEqual({ "conv-1": "accepted", "conv-2": "accepted", "conv-3": "accepted" });

    expect(team.counts.teamStatus.get(TEAM_ID)).toBe(1);
    expect(team.counts.membership.get(`${PARTICIPANT_UID}|${TEAM_ID}`)).toBe(1);
    expect(team.counts.membership.get(`${OWNER_UID}|${TEAM_ID}`)).toBe(1);
    // The binding is conversation-specific, so the index and the owner document are still read per item.
    expect(counted.counts.participation).toBe(3);
    expect(counted.counts.owner).toBe(3);
  });

  it("makes the binding decision per conversation: a stale memberRef on one item is unavailable even when another item for the same participant and team holds", async () => {
    const { base, codec, deps } = await setup(rosterTeam([OWNER_UID, PARTICIPANT_UID]));
    await seedBound(base, codec, "conv-fresh");
    await seedBound(base, codec, "conv-stale");
    await setStoredRef(base, "conv-stale", STALE_REF);

    const result = await readOwnerConversations(OWNER_UID, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(participantStates(result.conversations)).toEqual({ "conv-fresh": "accepted", "conv-stale": "unavailable" });
  });

  it("keeps the stale binding in the detail view too: the memo carries no decision between calls", async () => {
    const { base, codec, deps } = await setup(rosterTeam([OWNER_UID, PARTICIPANT_UID]));
    await seedBound(base, codec, "conv-fresh");
    await seedBound(base, codec, "conv-stale");
    await setStoredRef(base, "conv-stale", STALE_REF);

    const fresh = await readOwnerConversation(OWNER_UID, "conv-fresh", deps);
    const stale = await readOwnerConversation(OWNER_UID, "conv-stale", deps);
    expect(fresh.ok && fresh.conversation.participant.state).toBe("accepted");
    expect(stale.ok && stale.conversation.participant.state).toBe("unavailable");
  });

  it("does not collide keys for different participant or team pairs", async () => {
    const teams: FakeTeamEligibilityState = {
      teamStatus: { [TEAM_ID]: "active", [TEAM_BETA]: "active" },
      memberships: {
        ...rosterTeam([OWNER_UID, PARTICIPANT_UID]).memberships,
        // The owner is a member of TEAM_BETA too; the participant is not, so the same uid differs by team.
        [`${OWNER_UID}__${TEAM_BETA}`]: { uid: OWNER_UID, teamId: TEAM_BETA, createdAt: new Date(0), memberRef: "0123456789abcdefghjkmnpqrs" },
      },
    };
    const { base, codec, deps } = await setup(teams);
    await seedBound(base, codec, "conv-in-team", { teamId: TEAM_ID });
    await seedBound(base, codec, "conv-other-team", { teamId: TEAM_BETA });
    // A second participant with no membership anywhere must not inherit the first participant's result.
    await seedBound(base, codec, "conv-other-uid", { participantUid: "participant-2", teamId: TEAM_ID });

    const result = await readOwnerConversations(OWNER_UID, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(participantStates(result.conversations)).toEqual({
      "conv-in-team": "accepted",
      "conv-other-team": "unavailable",
      "conv-other-uid": "unavailable",
    });
  });

  it("maps a cached operational team read failure to persistence_failed, never to unavailable", async () => {
    const teams: FakeTeamEligibilityState = { ...rosterTeam([OWNER_UID, PARTICIPANT_UID]), failTeamRead: true };
    const { base, codec, deps } = await setup(teams);
    await seedBound(base, codec, "conv-1");
    await seedBound(base, codec, "conv-2");

    expect(await readOwnerConversations(OWNER_UID, deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("maps a cached operational membership read failure to persistence_failed on the list and the detail", async () => {
    const teams: FakeTeamEligibilityState = { ...rosterTeam([OWNER_UID, PARTICIPANT_UID]), failMembershipRead: true };
    const { base, codec, deps } = await setup(teams);
    await seedBound(base, codec, "conv-1");

    expect(await readOwnerConversations(OWNER_UID, deps)).toEqual({ ok: false, error: "persistence_failed" });
    expect(await readOwnerConversation(OWNER_UID, "conv-1", deps)).toEqual({ ok: false, error: "persistence_failed" });
  });

  it("is request-scoped: a second list call performs fresh team and membership reads", async () => {
    const { base, codec, deps, team } = await setup(rosterTeam([OWNER_UID, PARTICIPANT_UID]));
    await seedBound(base, codec, "conv-1");

    await readOwnerConversations(OWNER_UID, deps);
    await readOwnerConversations(OWNER_UID, deps);

    expect(team.counts.teamStatus.get(TEAM_ID)).toBe(2);
    expect(team.counts.membership.get(`${PARTICIPANT_UID}|${TEAM_ID}`)).toBe(2);
  });

  it("keeps participantNotes visible while the participant is unavailable (CL-21): availability never filters history", async () => {
    const { base, codec, deps } = await setup(rosterTeam([OWNER_UID, PARTICIPANT_UID]));
    await seedBound(base, codec, "conv-stale", { participantNotes: "Synthetic note from the participant" });
    await setStoredRef(base, "conv-stale", STALE_REF);

    const detail = await readOwnerConversation(OWNER_UID, "conv-stale", deps);
    expect(detail.ok && detail.conversation.participant.state).toBe("unavailable");
    expect(detail.ok && detail.conversation.participantNotes).toBe("Synthetic note from the participant");
  });
});

import { describe, expect, it } from "vitest";
import { createFakeContentCodec } from "./fake-content-codec";
import { createFakeConversationStore } from "./fake-conversation-store";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { createProductionParticipantStateResolver } from "./owner-participant-state";
import {
  OWNER_UID,
  OTHER_OWNER_UID,
  PARTICIPANT_UID,
  TEAM_ID,
  rosterTeam,
  seedOwnerConversation,
} from "./owner-read-test-support";

/** Synthetic fixtures for the owner-side BR-21 check (BR-42). No real person or wellbeing data. */
const CONVERSATION_ID = "conv-state-1";

async function setup(options: { state?: "pending" | "accepted"; teams?: Partial<FakeTeamEligibilityState> } = {}) {
  const codec = createFakeContentCodec();
  const teams: FakeTeamEligibilityState = { ...rosterTeam([PARTICIPANT_UID]), ...options.teams };
  const store = createFakeConversationStore({ teams });
  await seedOwnerConversation(store, codec, {
    conversationId: CONVERSATION_ID,
    participant: { uid: PARTICIPANT_UID, state: options.state ?? "accepted" },
  });
  await store.runTransaction(async (tx) => {
    tx.setParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OWNER_UID, invitedAt: new Date("2026-10-17T10:00:00.000Z") });
  });
  const resolver = createProductionParticipantStateResolver(store);
  const input = {
    ownerUid: OWNER_UID,
    conversationId: CONVERSATION_ID,
    teamId: TEAM_ID,
    participantUid: PARTICIPANT_UID,
    teamReader: createFakeTeamEligibilityReader(teams),
  };
  return { store, teams, resolver, input };
}

describe("production participant-state resolver (owner-side BR-21, BR-42)", () => {
  it("holds for an accepted participant with an index, an active team and a matching memberRef", async () => {
    const { resolver, input } = await setup({ state: "accepted" });
    await expect(resolver(input)).resolves.toBe(true);
  });

  it("holds for a pending invitee with the same binding checks (BR-21 (c), pending branch)", async () => {
    const { resolver, input } = await setup({ state: "pending" });
    await expect(resolver(input)).resolves.toBe(true);
  });

  it("does not hold when the index is absent", async () => {
    const { store, resolver, input } = await setup();
    await store.runTransaction(async (tx) => tx.deleteParticipation(PARTICIPANT_UID, CONVERSATION_ID));
    await expect(resolver(input)).resolves.toBe(false);
  });

  it("does not hold when the index names a different owner", async () => {
    const { store, resolver, input } = await setup();
    await store.runTransaction(async (tx) => {
      tx.setParticipation(PARTICIPANT_UID, CONVERSATION_ID, { ownerUid: OTHER_OWNER_UID, invitedAt: new Date("2026-10-17T10:00:00.000Z") });
    });
    await expect(resolver(input)).resolves.toBe(false);
  });

  it("does not hold when the index is malformed (an extra field fails the index parser)", async () => {
    const { store, resolver, input } = await setup();
    store.seedRawParticipation(PARTICIPANT_UID, CONVERSATION_ID, {
      ownerUid: OWNER_UID,
      invitedAt: new Date("2026-10-17T10:00:00.000Z"),
      unexpectedField: "synthetic",
    });
    await expect(resolver(input)).resolves.toBe(false);
  });

  it("does not hold when the owner document is malformed (an unknown key fails the shape check)", async () => {
    const { store, resolver, input } = await setup();
    const raw = (await store.getOwner(OWNER_UID, CONVERSATION_ID)) as Record<string, unknown>;
    store.seedRawOwner(OWNER_UID, CONVERSATION_ID, { ...raw, unexpectedField: "synthetic" });
    await expect(resolver(input)).resolves.toBe(false);
  });

  it("does not hold when the caller is not the participant named by the owner document", async () => {
    const { resolver, input } = await setup();
    await expect(resolver({ ...input, participantUid: "someone-else" })).resolves.toBe(false);
  });

  it("does not hold when the team in the input is not the owner document's team", async () => {
    const { resolver, input } = await setup();
    await expect(resolver({ ...input, teamId: "team-other" })).resolves.toBe(false);
  });

  it("does not hold when the team is disabled (BR-31)", async () => {
    const { teams, resolver, input } = await setup();
    teams.teamStatus[TEAM_ID] = "disabled";
    await expect(resolver(input)).resolves.toBe(false);
  });

  it("does not hold when the membership is gone (BR-21 (e))", async () => {
    const { teams, resolver, input } = await setup();
    teams.memberships = {};
    await expect(resolver(input)).resolves.toBe(false);
  });

  it("does not hold when the membership document is malformed (fails closed as not eligible)", async () => {
    const { teams, resolver, input } = await setup();
    teams.memberships = { [`${PARTICIPANT_UID}__${TEAM_ID}`]: "not a membership" };
    await expect(resolver(input)).resolves.toBe(false);
  });

  it("does not hold after a rejoin with a new memberRef, even under the same uid (CL-23)", async () => {
    const { teams, resolver, input } = await setup();
    const membershipKey = `${PARTICIPANT_UID}__${TEAM_ID}`;
    teams.memberships = { [membershipKey]: { ...(teams.memberships[membershipKey] as object), memberRef: "zzzzzzzzzzzzzzzzzzzzzzzzzz" } };
    await expect(resolver(input)).resolves.toBe(false);
  });

  it("rejects on an operational index read failure, so the caller reports persistence_failed and never unavailable", async () => {
    const { store, input, teams } = await setup();
    const failingStore = {
      ...store,
      getParticipation: async () => {
        throw new Error("simulated index read failure");
      },
    };
    const resolver = createProductionParticipantStateResolver(failingStore);
    await expect(resolver({ ...input, teamReader: createFakeTeamEligibilityReader(teams) })).rejects.toThrow();
  });

  it("rejects on an operational team read failure, so the caller reports persistence_failed and never unavailable", async () => {
    const { teams, resolver, input } = await setup();
    teams.failTeamRead = true;
    await expect(resolver(input)).rejects.toThrow();
  });

  it("rejects on an operational membership read failure", async () => {
    const { teams, resolver, input } = await setup();
    teams.failMembershipRead = true;
    await expect(resolver(input)).rejects.toThrow();
  });
});

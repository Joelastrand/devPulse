import { describe, expect, it } from "vitest";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { readGenuineActiveMembership } from "./team-eligibility";
import { authorizeParticipant, type ParticipantAccessMaterial } from "./authorize-participant";
import { OWNER_UID, PARTICIPANT_MEMBER_REF, PARTICIPANT_UID, TEAM_ID, NOW, rosterTeam } from "./owner-read-test-support";
import type { GenuineMembershipResult } from "./team-eligibility";

// Synthetic fixtures only (invariant 15). No real person, team or wellbeing data.
const CALLER = PARTICIPANT_UID;
const OTHER_REF = "zyxwvtsrqpnmkjhgfedcba9876";

/** A valid index entry, as the invitation transaction writes it. */
function index(ownerUid: string = OWNER_UID): Record<string, unknown> {
  return { ownerUid, invitedAt: new Date(NOW.getTime() + 1000) };
}

/** A valid owner document, plain fields only, with an accepted participant. */
function owner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    teamId: TEAM_ID,
    participantUid: CALLER,
    participantMemberRef: PARTICIPANT_MEMBER_REF,
    participantState: "accepted",
    participantInvitedAt: new Date(NOW.getTime() + 1000),
    participantAcceptedAt: new Date(NOW.getTime() + 2000),
    plannedFor: null,
    status: "open",
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ciphertext: "AAAA",
    iv: "AAAAAAAAAAAAAAAA",
    authTag: "AAAAAAAAAAAAAAAAAAAAAA==",
    keyVersion: "v1",
    keyCheck: "A".repeat(43) + "=",
    ...overrides,
  };
}

/** The TASK-006 result for the caller, read from the given team state, as the operation obtains it. */
async function membershipOf(state: FakeTeamEligibilityState, uid: string = CALLER): Promise<GenuineMembershipResult> {
  return readGenuineActiveMembership(uid, TEAM_ID, createFakeTeamEligibilityReader(state));
}

/** A complete, allowed material set. Each test changes one input to exercise one BR-21 condition. */
async function allowedMaterial(overrides: Partial<ParticipantAccessMaterial> = {}): Promise<ParticipantAccessMaterial> {
  return {
    callerUid: CALLER,
    index: index(),
    owner: owner(),
    membership: await membershipOf(rosterTeam([OWNER_UID, CALLER])),
    ...overrides,
  };
}

describe("authorizeParticipant: BR-21 access decision", () => {
  it("allows an accepted, eligible participant and names the owner and team", async () => {
    expect(authorizeParticipant(await allowedMaterial())).toEqual({ allowed: true, ownerUid: OWNER_UID, teamId: TEAM_ID });
  });

  it("denies when the index entry is missing (a)", async () => {
    expect(authorizeParticipant(await allowedMaterial({ index: undefined }))).toEqual({ allowed: false });
  });

  it("denies when the index entry has no ownerUid (a)", async () => {
    expect(authorizeParticipant(await allowedMaterial({ index: { invitedAt: NOW } }))).toEqual({ allowed: false });
  });

  it("denies when the owner document is missing (b)", async () => {
    expect(authorizeParticipant(await allowedMaterial({ owner: undefined }))).toEqual({ allowed: false });
  });

  it("denies when the owner document is structurally malformed (b)", async () => {
    expect(authorizeParticipant(await allowedMaterial({ owner: owner({ title: "extra plaintext key" }) }))).toEqual({
      allowed: false,
    });
  });

  it("denies when the participantUid is someone else (c)", async () => {
    const material = await allowedMaterial({ owner: owner({ participantUid: "participant-2" }) });
    expect(authorizeParticipant(material)).toEqual({ allowed: false });
  });

  it("denies a pending participant on the content path (c)", async () => {
    const material = await allowedMaterial({ owner: owner({ participantState: "pending", participantAcceptedAt: null }) });
    expect(authorizeParticipant(material)).toEqual({ allowed: false });
  });

  it("denies when no participant is bound (c)", async () => {
    const material = await allowedMaterial({
      owner: owner({ participantUid: null, participantMemberRef: null, participantState: null, participantInvitedAt: null, participantAcceptedAt: null }),
    });
    expect(authorizeParticipant(material)).toEqual({ allowed: false });
  });

  it("denies when the team is disabled (d)", async () => {
    const state = rosterTeam([OWNER_UID, CALLER]);
    state.teamStatus[TEAM_ID] = "disabled";
    expect(authorizeParticipant(await allowedMaterial({ membership: await membershipOf(state) }))).toEqual({ allowed: false });
  });

  it("denies when the caller's membership is missing (e)", async () => {
    const state = rosterTeam([OWNER_UID]);
    expect(authorizeParticipant(await allowedMaterial({ membership: await membershipOf(state) }))).toEqual({ allowed: false });
  });

  it("allows a lead as an ordinary member: the role is never an input (e)", async () => {
    const state = rosterTeam([OWNER_UID]);
    state.memberships[`${CALLER}__${TEAM_ID}`] = {
      uid: CALLER,
      teamId: TEAM_ID,
      createdAt: new Date(0),
      memberRef: PARTICIPANT_MEMBER_REF,
      role: "lead",
    };
    expect(authorizeParticipant(await allowedMaterial({ membership: await membershipOf(state) }))).toEqual({
      allowed: true,
      ownerUid: OWNER_UID,
      teamId: TEAM_ID,
    });
  });

  it("denies a non-member the same way whatever role or admin state exists elsewhere; no admin input exists (e)", async () => {
    const state = rosterTeam([OWNER_UID]);
    expect(authorizeParticipant(await allowedMaterial({ membership: await membershipOf(state) }))).toEqual({ allowed: false });
  });

  it("denies a rejoined member whose membership carries a new memberRef (e, binding)", async () => {
    const state = rosterTeam([OWNER_UID, CALLER]);
    state.memberships[`${CALLER}__${TEAM_ID}`] = { uid: CALLER, teamId: TEAM_ID, createdAt: new Date(0), memberRef: OTHER_REF };
    expect(authorizeParticipant(await allowedMaterial({ membership: await membershipOf(state) }))).toEqual({ allowed: false });
  });

  it("denies when the stored binding is absent, even with a current membership", async () => {
    const material = await allowedMaterial({ owner: owner({ participantMemberRef: null }) });
    expect(authorizeParticipant(material)).toEqual({ allowed: false });
  });

  it("returns the same denial shape for every failing condition", async () => {
    const denials = await Promise.all([
      allowedMaterial({ index: undefined }),
      allowedMaterial({ owner: undefined }),
      allowedMaterial({ owner: owner({ participantState: "pending", participantAcceptedAt: null }) }),
    ]);
    for (const material of denials) {
      expect(authorizeParticipant(material)).toStrictEqual({ allowed: false });
    }
  });
});

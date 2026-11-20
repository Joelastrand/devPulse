import { describe, expect, it } from "vitest";
import { MAX_TEAM_BINDINGS } from "../domain/team-bindings";
import { createFakeSharedTeamReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import {
  authorizeBoundParticipant,
  boundMemberships,
  confirmBoundColleague,
  MAX_OWNER_MEMBERSHIPS,
  resolveColleagueRef,
  type BoundColleague,
} from "./shared-team-binding";

// Synthetic fixtures only (invariant 15). Every uid, team and reference is fictional.
const OWNER = "owner-1";
const PERSON = "colleague-1";
const OUTSIDER = "outsider-1";
const TEAM_A = "team-a";
const TEAM_B = "team-b";
const TEAM_C = "team-c";

const OWNER_REF_A = "2468ace7bdfhjkmnpqrstvwxyz";
const PERSON_REF_A = "0123456789abcdefghjkmnpqrs";
const OWNER_REF_B = "zyxwvtsrqpnmkjhgfedcba9876";
const PERSON_REF_B = "mnpqrstvwxyz0123456789abcd";
const OWNER_REF_C = "abcdefghjkmnpqrstvwxyz0123";
const PERSON_REF_C = "9876543210zyxwvtsrqpnmkjhg";
const PERSON_REF_REJOINED = "abcdefghjkmnpqrstvwxyz0123";
const OUTSIDER_REF = "2468acedgikmnpqrstuvwxyzbf";

function membership(uid: string, teamId: string, memberRef: string): Record<string, unknown> {
  return { uid, teamId, createdAt: new Date(0), memberRef };
}

/** A team in which the owner and the person both hold a genuine membership, with the given references. */
function addSharedTeam(state: FakeTeamEligibilityState, teamId: string, ownerRef: string, personRef: string): void {
  state.teamStatus[teamId] = "active";
  state.memberships[`${OWNER}__${teamId}`] = membership(OWNER, teamId, ownerRef);
  state.memberships[`${PERSON}__${teamId}`] = membership(PERSON, teamId, personRef);
}

/** Two shared active teams: the owner and the person are both in TEAM_A and TEAM_B. */
function twoSharedTeams(): FakeTeamEligibilityState {
  const state: FakeTeamEligibilityState = { teamStatus: {}, memberships: {} };
  addSharedTeam(state, TEAM_A, OWNER_REF_A, PERSON_REF_A);
  addSharedTeam(state, TEAM_B, OWNER_REF_B, PERSON_REF_B);
  state.memberships[`${OUTSIDER}__${TEAM_C}`] = membership(OUTSIDER, TEAM_C, OUTSIDER_REF);
  state.teamStatus[TEAM_C] = "active";
  return state;
}

/** The binding a fresh invitation records for the two shared teams above. */
function bothTeamBindings(): Record<string, { ownerMemberRef: string; participantMemberRef: string }> {
  return {
    [TEAM_A]: { ownerMemberRef: OWNER_REF_A, participantMemberRef: PERSON_REF_A },
    [TEAM_B]: { ownerMemberRef: OWNER_REF_B, participantMemberRef: PERSON_REF_B },
  };
}

/** Counts owner-membership listings, so a test can prove a bound is enforced before reads. */
function countingListReads(state: FakeTeamEligibilityState) {
  const reader = createFakeSharedTeamReader(state);
  const counted = { ...reader, listings: 0 };
  counted.listOwnMemberships = (uid, limit) => {
    counted.listings += 1;
    return reader.listOwnMemberships(uid, limit);
  };
  return counted;
}

describe("resolveColleagueRef: derives the bindings at invitation (A2.1 revised, policy 1)", () => {
  it("records every active team the owner and the colleague share, each with both current references", async () => {
    const result = await resolveColleagueRef(OWNER, PERSON_REF_A, createFakeSharedTeamReader(twoSharedTeams()));
    expect(result).toEqual({ ok: true, colleague: { uid: PERSON, bindings: bothTeamBindings() } });
  });

  it("does not record a team the colleague is not in with the owner", async () => {
    const state = twoSharedTeams();
    delete state.memberships[`${PERSON}__${TEAM_B}`];
    const result = await resolveColleagueRef(OWNER, PERSON_REF_A, createFakeSharedTeamReader(state));
    expect(result).toEqual({
      ok: true,
      colleague: { uid: PERSON, bindings: { [TEAM_A]: bothTeamBindings()[TEAM_A] } },
    });
  });

  it("does not record a disabled team", async () => {
    const state = twoSharedTeams();
    state.teamStatus[TEAM_B] = "disabled";
    const result = await resolveColleagueRef(OWNER, PERSON_REF_A, createFakeSharedTeamReader(state));
    expect(result).toEqual({ ok: true, colleague: { uid: PERSON, bindings: { [TEAM_A]: bothTeamBindings()[TEAM_A] } } });
  });

  it("refuses a colleague who shares no active team with the owner", async () => {
    expect(await resolveColleagueRef(OWNER, OUTSIDER_REF, createFakeSharedTeamReader(twoSharedTeams()))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("refuses the owner's own reference", async () => {
    expect(await resolveColleagueRef(OWNER, OWNER_REF_A, createFakeSharedTeamReader(twoSharedTeams()))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("refuses a malformed reference before any lookup", async () => {
    const counted = countingListReads(twoSharedTeams());
    expect(await resolveColleagueRef(OWNER, "not-a-ref", counted)).toEqual({ ok: false, error: "not_eligible" });
    expect(counted.listings).toBe(0);
  });

  it("refuses when the owner has more memberships than the bounded read, instead of truncating", async () => {
    const state: FakeTeamEligibilityState = { teamStatus: {}, memberships: {} };
    addSharedTeam(state, TEAM_A, OWNER_REF_A, PERSON_REF_A);
    for (let index = 0; index < MAX_OWNER_MEMBERSHIPS; index += 1) {
      state.memberships[`${OWNER}__filler-${index}`] = membership(OWNER, `filler-${index}`, OUTSIDER_REF);
    }
    expect(await resolveColleagueRef(OWNER, PERSON_REF_A, createFakeSharedTeamReader(state))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("refuses when more shared teams exist than the binding bound, instead of truncating the set", async () => {
    const state: FakeTeamEligibilityState = { teamStatus: {}, memberships: {} };
    for (let index = 0; index <= MAX_TEAM_BINDINGS; index += 1) {
      addSharedTeam(state, `shared-${index}`, OWNER_REF_A, PERSON_REF_A);
    }
    expect(await resolveColleagueRef(OWNER, PERSON_REF_A, createFakeSharedTeamReader(state))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("skips a malformed owner membership row instead of binding through it", async () => {
    const state = twoSharedTeams();
    state.memberships[`${OWNER}__${TEAM_B}`] = { uid: "someone-else", teamId: TEAM_B, memberRef: OWNER_REF_B };
    const result = await resolveColleagueRef(OWNER, PERSON_REF_A, createFakeSharedTeamReader(state));
    expect(result).toEqual({ ok: true, colleague: { uid: PERSON, bindings: { [TEAM_A]: bothTeamBindings()[TEAM_A] } } });
  });

  it("reports a failed read as read_failed, never as a denial", async () => {
    const state = twoSharedTeams();
    state.failMembershipRead = true;
    expect(await resolveColleagueRef(OWNER, PERSON_REF_A, createFakeSharedTeamReader(state))).toEqual({
      ok: false,
      error: "read_failed",
    });
  });
});

describe("authorizeBoundParticipant: the per-request check over the recorded bindings (policies 2 to 6)", () => {
  it("holds while a recorded team still holds for both people", async () => {
    expect(await authorizeBoundParticipant(OWNER, PERSON, bothTeamBindings(), createFakeSharedTeamReader(twoSharedTeams()))).toEqual({
      ok: true,
      teamId: TEAM_A,
    });
  });

  it("keeps access when one recorded shared team is lost and another recorded team still holds (policy 3)", async () => {
    const state = twoSharedTeams();
    delete state.memberships[`${PERSON}__${TEAM_A}`];
    expect(await authorizeBoundParticipant(OWNER, PERSON, bothTeamBindings(), createFakeSharedTeamReader(state))).toEqual({
      ok: true,
      teamId: TEAM_B,
    });
  });

  it("keeps access when the owner leaves one recorded team but the other still holds", async () => {
    const state = twoSharedTeams();
    delete state.memberships[`${OWNER}__${TEAM_A}`];
    expect(await authorizeBoundParticipant(OWNER, PERSON, bothTeamBindings(), createFakeSharedTeamReader(state))).toEqual({
      ok: true,
      teamId: TEAM_B,
    });
  });

  it("does not restore access when the person leaves and rejoins a recorded team under a new reference (policy 4)", async () => {
    const state = { ...twoSharedTeams(), memberships: { ...twoSharedTeams().memberships } };
    state.memberships[`${PERSON}__${TEAM_A}`] = membership(PERSON, TEAM_A, PERSON_REF_REJOINED);
    delete state.memberships[`${PERSON}__${TEAM_B}`];
    expect(await authorizeBoundParticipant(OWNER, PERSON, bothTeamBindings(), createFakeSharedTeamReader(state))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("does not restore access when the owner rejoins a recorded team under a new reference", async () => {
    const state = twoSharedTeams();
    state.memberships[`${OWNER}__${TEAM_A}`] = membership(OWNER, TEAM_A, OWNER_REF_C);
    state.memberships[`${OWNER}__${TEAM_B}`] = membership(OWNER, TEAM_B, OWNER_REF_C);
    expect(await authorizeBoundParticipant(OWNER, PERSON, bothTeamBindings(), createFakeSharedTeamReader(state))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("does not add a team that became shared after the invitation (policy 5)", async () => {
    const state = twoSharedTeams();
    delete state.memberships[`${PERSON}__${TEAM_A}`];
    delete state.memberships[`${PERSON}__${TEAM_B}`];
    addSharedTeam(state, TEAM_C, OWNER_REF_C, PERSON_REF_C);
    expect(await authorizeBoundParticipant(OWNER, PERSON, bothTeamBindings(), createFakeSharedTeamReader(state))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("denies access once every recorded team has become invalid (policy 6)", async () => {
    const state = twoSharedTeams();
    state.teamStatus[TEAM_A] = "disabled";
    delete state.memberships[`${PERSON}__${TEAM_B}`];
    expect(await authorizeBoundParticipant(OWNER, PERSON, bothTeamBindings(), createFakeSharedTeamReader(state))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("does not hold for a caller who is not the uid the bindings name", async () => {
    expect(await authorizeBoundParticipant(OWNER, OUTSIDER, bothTeamBindings(), createFakeSharedTeamReader(twoSharedTeams()))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("refuses a malformed or absent stored binding map, without any read", async () => {
    const counted = countingListReads(twoSharedTeams());
    const malformed: unknown[] = [
      null,
      {},
      "short",
      { [TEAM_A]: { ownerMemberRef: OWNER_REF_A } },
      { [TEAM_A]: { ownerMemberRef: OWNER_REF_A, participantMemberRef: "not-a-ref" } },
      { [TEAM_A]: { ownerMemberRef: OWNER_REF_A, participantMemberRef: PERSON_REF_A, extra: true } },
      { "__reserved__": { ownerMemberRef: OWNER_REF_A, participantMemberRef: PERSON_REF_A } },
    ];
    for (const stored of malformed) {
      expect(await authorizeBoundParticipant(OWNER, PERSON, stored, counted)).toEqual({ ok: false, error: "not_eligible" });
    }
  });

  it("refuses an oversized binding map, rather than checking a truncated subset", async () => {
    const oversized: Record<string, { ownerMemberRef: string; participantMemberRef: string }> = {};
    for (let index = 0; index <= MAX_TEAM_BINDINGS; index += 1) {
      oversized[`team-${index}`] = { ownerMemberRef: OWNER_REF_A, participantMemberRef: PERSON_REF_A };
    }
    expect(await authorizeBoundParticipant(OWNER, PERSON, oversized, createFakeSharedTeamReader(twoSharedTeams()))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("reports a failed read as read_failed when no recorded team can be confirmed", async () => {
    const state = twoSharedTeams();
    state.failMembershipRead = true;
    expect(await authorizeBoundParticipant(OWNER, PERSON, bothTeamBindings(), createFakeSharedTeamReader(state))).toEqual({
      ok: false,
      error: "read_failed",
    });
  });
});

describe("confirmBoundColleague: transactional revalidation before an invitation is written (BR-48)", () => {
  function colleagueOf(bindings: BoundColleague["bindings"]): BoundColleague {
    return { uid: PERSON, bindings };
  }

  it("confirms while every recorded binding still holds", async () => {
    expect(await confirmBoundColleague(OWNER, colleagueOf(bothTeamBindings()), createFakeSharedTeamReader(twoSharedTeams()))).toEqual({
      ok: true,
    });
  });

  it("refuses when one recorded reference changed between resolution and the write", async () => {
    const state = twoSharedTeams();
    state.memberships[`${PERSON}__${TEAM_B}`] = membership(PERSON, TEAM_B, PERSON_REF_REJOINED);
    expect(await confirmBoundColleague(OWNER, colleagueOf(bothTeamBindings()), createFakeSharedTeamReader(state))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });

  it("refuses a colleague that is the owner, whatever the reads say", async () => {
    expect(await confirmBoundColleague(OWNER, { uid: OWNER, bindings: bothTeamBindings() }, createFakeSharedTeamReader(twoSharedTeams()))).toEqual({
      ok: false,
      error: "not_eligible",
    });
  });
});

describe("boundMemberships: the instances a binding names, for transactional coordination", () => {
  it("lists the owner's and the colleague's membership in every recorded team", () => {
    expect(boundMemberships(OWNER, { uid: PERSON, bindings: bothTeamBindings() })).toEqual([
      { uid: OWNER, teamId: TEAM_A, memberRef: OWNER_REF_A },
      { uid: PERSON, teamId: TEAM_A, memberRef: PERSON_REF_A },
      { uid: OWNER, teamId: TEAM_B, memberRef: OWNER_REF_B },
      { uid: PERSON, teamId: TEAM_B, memberRef: PERSON_REF_B },
    ]);
  });
});

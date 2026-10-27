import { describe, expect, it } from "vitest";
import { createFakeTeamEligibilityReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { requestScopedTeamReader } from "./request-scoped-team-reader";
import { rosterTeam, TEAM_ID } from "./owner-read-test-support";
import { PARTICIPANT_UID } from "./owner-read-test-support";

/** Counts raw calls to the base reader, keyed by the arguments, so a test can prove a read was shared or repeated. */
function countingReader(state: FakeTeamEligibilityState) {
  const base = createFakeTeamEligibilityReader(state);
  const statusCalls: string[] = [];
  const membershipCalls: string[] = [];
  return {
    statusCalls,
    membershipCalls,
    reader: {
      getTeamStatus: (teamId: string) => {
        statusCalls.push(teamId);
        return base.getTeamStatus(teamId);
      },
      getMembership: (uid: string, teamId: string) => {
        membershipCalls.push(`${uid}|${teamId}`);
        return base.getMembership(uid, teamId);
      },
    },
  };
}

describe("requestScopedTeamReader (TASK-023 owner-list memo)", () => {
  it("reads each team status and each (uid, team) membership once per memo, however many callers ask", async () => {
    const counted = countingReader(rosterTeam([PARTICIPANT_UID]));
    const memo = requestScopedTeamReader(counted.reader);

    await memo.getTeamStatus(TEAM_ID);
    await memo.getTeamStatus(TEAM_ID);
    await memo.getMembership(PARTICIPANT_UID, TEAM_ID);
    await memo.getMembership(PARTICIPANT_UID, TEAM_ID);

    expect(counted.statusCalls).toEqual([TEAM_ID]);
    expect(counted.membershipCalls).toEqual([`${PARTICIPANT_UID}|${TEAM_ID}`]);
  });

  it("keeps distinct (uid, team) pairs apart: a membership for one pair is never returned for another", async () => {
    const counted = countingReader({ ...rosterTeam([PARTICIPANT_UID]), teamStatus: { [TEAM_ID]: "active", "team-beta": "active" } });
    const memo = requestScopedTeamReader(counted.reader);

    const inTeam = await memo.getMembership(PARTICIPANT_UID, TEAM_ID);
    const inOtherTeam = await memo.getMembership(PARTICIPANT_UID, "team-beta");
    const otherUid = await memo.getMembership("someone-else", TEAM_ID);

    expect(inTeam).toBeDefined();
    expect(inOtherTeam).toBeUndefined();
    expect(otherUid).toBeUndefined();
    expect(counted.membershipCalls).toHaveLength(3);
  });

  it("never joins two different pairs into one key, even when an id contains the delimiter character", async () => {
    const counted = countingReader(rosterTeam([PARTICIPANT_UID]));
    const memo = requestScopedTeamReader(counted.reader);

    // Both pairs would be "a\0b\0c" under a NUL-joined key.
    await memo.getMembership("a\u0000b", "c");
    await memo.getMembership("a", "b\u0000c");

    expect(counted.membershipCalls).toHaveLength(2);
  });

  it("shares a rejected read as the same operational failure for every caller in the request", async () => {
    const memo = requestScopedTeamReader(createFakeTeamEligibilityReader({ ...rosterTeam([PARTICIPANT_UID]), failTeamRead: true }));

    await expect(memo.getTeamStatus(TEAM_ID)).rejects.toThrow("simulated team read failure");
    await expect(memo.getTeamStatus(TEAM_ID)).rejects.toThrow("simulated team read failure");
  });

  it("holds no state across memos: a second memo performs fresh reads", async () => {
    const counted = countingReader(rosterTeam([PARTICIPANT_UID]));
    await requestScopedTeamReader(counted.reader).getTeamStatus(TEAM_ID);
    await requestScopedTeamReader(counted.reader).getTeamStatus(TEAM_ID);

    expect(counted.statusCalls).toEqual([TEAM_ID, TEAM_ID]);
  });
});

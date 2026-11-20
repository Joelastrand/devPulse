import { describe, expect, it } from "vitest";
import { createFakeSharedTeamReader, createFakeTeamMemberListReader, type FakeTeamEligibilityState } from "./fake-team-eligibility";
import { listEligibleColleagues, MAX_MEMBERS_PER_TEAM, type ColleagueListDeps } from "./list-eligible-colleagues";

// Synthetic fixtures only (invariant 15). Every uid, team, name and reference is fictional.
const OWNER = "owner-1";
const TEAM_A = "team-a";
const TEAM_B = "team-b";
const TEAM_DISABLED = "team-disabled";
const TEAM_OTHER = "team-other";

const OWNER_REF_A = "2468ace7bdfhjkmnpqrstvwxyz";
const OWNER_REF_B = "zyxwvtsrqpnmkjhgfedcba9876";
const OWNER_REF_DIS = "abcdefghjkmnpqrstvwxyz0123";

const ANNA_A = "0123456789abcdefghjkmnpqrs";
const ANNA_B = "9876543210zyxwvtsrqpnmkjhg";
const KARI_2 = "abcdefghjkmnpqrstvwxyz0124";
const KARI_3 = "abcdefghjkmnpqrstvwxyz0125";
const NAMELESS = "abcdefghjkmnpqrstvwxyz0126";
const DISABLED_MEMBER = "abcdefghjkmnpqrstvwxyz0127";
const OUTSIDER = "abcdefghjkmnpqrstvwxyz0128";

function membership(uid: string, teamId: string, memberRef: string): Record<string, unknown> {
  return { uid, teamId, createdAt: new Date(0), memberRef };
}

/** The owner is a genuine member of A, B and the disabled team, and of nothing in TEAM_OTHER. */
function baseState(): FakeTeamEligibilityState {
  const state: FakeTeamEligibilityState = {
    teamStatus: { [TEAM_A]: "active", [TEAM_B]: "active", [TEAM_DISABLED]: "disabled", [TEAM_OTHER]: "active" },
    memberships: {
      [`${OWNER}__${TEAM_A}`]: membership(OWNER, TEAM_A, OWNER_REF_A),
      [`${OWNER}__${TEAM_B}`]: membership(OWNER, TEAM_B, OWNER_REF_B),
      [`${OWNER}__${TEAM_DISABLED}`]: membership(OWNER, TEAM_DISABLED, OWNER_REF_DIS),
      [`anna-1__${TEAM_A}`]: membership("anna-1", TEAM_A, ANNA_A),
      [`anna-1__${TEAM_B}`]: membership("anna-1", TEAM_B, ANNA_B),
      [`kari-2__${TEAM_A}`]: membership("kari-2", TEAM_A, KARI_2),
      [`kari-3__${TEAM_A}`]: membership("kari-3", TEAM_A, KARI_3),
      [`nameless-4__${TEAM_B}`]: membership("nameless-4", TEAM_B, NAMELESS),
      [`dis-6__${TEAM_DISABLED}`]: membership("dis-6", TEAM_DISABLED, DISABLED_MEMBER),
      [`outsider-5__${TEAM_OTHER}`]: membership("outsider-5", TEAM_OTHER, OUTSIDER),
      // A malformed row: the document id does not name its own uid and team, so it cannot be a membership of anyone.
      "wrong-id": membership("bad-7", TEAM_A, "abcdefghjkmnpqrstvwxyz0129"),
    },
  };
  return state;
}

const NAMES: Record<string, string> = { "anna-1": "Anna Synthetic", "kari-2": "Kari Fiction", "kari-3": "Kari Fiction", "dis-6": "Disabled", "bad-7": "Bad" };

function depsFor(state: FakeTeamEligibilityState, names: Record<string, string> = NAMES): ColleagueListDeps {
  return {
    reader: createFakeSharedTeamReader(state),
    members: createFakeTeamMemberListReader(state),
    getNames: async (uids) => new Map(uids.flatMap((uid) => (uid in names ? [[uid, names[uid]] as [string, string]] : []))),
  };
}

describe("listEligibleColleagues: the eligible-colleague picker source (A2.1 revised, BR-9)", () => {
  it("lists each colleague who shares an active team with the caller, once, with an opaque reference and a name", async () => {
    const result = await listEligibleColleagues(OWNER, depsFor(baseState()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.colleagues.find((colleague) => colleague.displayName === "Anna Synthetic")).toEqual({
      memberRef: ANNA_A,
      displayName: "Anna Synthetic",
    });
    expect(result.colleagues.filter((colleague) => colleague.memberRef === ANNA_A || colleague.memberRef === ANNA_B)).toHaveLength(1);
  });

  it("excludes the caller, a person in an unshared team, a member of a disabled team, and a malformed row", async () => {
    const result = await listEligibleColleagues(OWNER, depsFor(baseState()));
    if (!result.ok) throw new Error("expected a listing");
    const refs = result.colleagues.map((colleague) => colleague.memberRef);
    expect(refs).not.toContain(OWNER_REF_A);
    expect(refs).not.toContain(OUTSIDER);
    expect(refs).not.toContain(DISABLED_MEMBER);
    expect(refs).not.toContain("abcdefghjkmnpqrstvwxyz0129");
  });

  it("never returns a uid, an e-mail or a team id", async () => {
    const result = await listEligibleColleagues(OWNER, depsFor(baseState()));
    if (!result.ok) throw new Error("expected a listing");
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("anna-1");
    expect(serialised).not.toContain("kari-2");
    expect(serialised).not.toContain(TEAM_A);
    for (const colleague of result.colleagues) expect(Object.keys(colleague).sort()).toEqual(["displayName", "memberRef"]);
  });

  it("lists duplicate names as separate entries, distinguished by their references", async () => {
    const result = await listEligibleColleagues(OWNER, depsFor(baseState()));
    if (!result.ok) throw new Error("expected a listing");
    const kari = result.colleagues.filter((colleague) => colleague.displayName === "Kari Fiction").map((colleague) => colleague.memberRef);
    expect(kari.sort()).toEqual([KARI_2, KARI_3]);
  });

  it("lists a colleague with no readable name with a null name, last, and never a fabricated name", async () => {
    const result = await listEligibleColleagues(OWNER, depsFor(baseState()));
    if (!result.ok) throw new Error("expected a listing");
    expect(result.colleagues.at(-1)).toEqual({ memberRef: NAMELESS, displayName: null });
  });

  it("returns an empty, complete list when the caller shares no active team with anyone", async () => {
    const state = baseState();
    delete state.memberships[`${OWNER}__${TEAM_A}`];
    delete state.memberships[`${OWNER}__${TEAM_B}`];
    expect(await listEligibleColleagues(OWNER, depsFor(state))).toEqual({ ok: true, colleagues: [], truncated: false });
  });

  it("refuses a colleague whose owner membership in that team is not genuine, so the owner's teams alone decide", async () => {
    const state = baseState();
    delete state.memberships[`${OWNER}__${TEAM_B}`];
    const result = await listEligibleColleagues(OWNER, depsFor(state));
    if (!result.ok) throw new Error("expected a listing");
    expect(result.colleagues.map((colleague) => colleague.memberRef)).not.toContain(NAMELESS);
  });

  it("fails the whole listing when a membership read fails, rather than presenting a partial list as complete", async () => {
    const state = baseState();
    state.failMembershipRead = true;
    expect(await listEligibleColleagues(OWNER, depsFor(state))).toEqual({ ok: false, error: "read_failed" });
  });

  it("fails the listing when the display-name lookup rejects, without a partial result", async () => {
    const deps = depsFor(baseState());
    deps.getNames = async () => {
      throw new Error("simulated profile failure");
    };
    expect(await listEligibleColleagues(OWNER, deps)).toEqual({ ok: false, error: "read_failed" });
  });

  it("marks the result truncated and returns at most the per-team bound when a team has more members", async () => {
    const state = baseState();
    for (let index = 0; index <= MAX_MEMBERS_PER_TEAM; index += 1) {
      const uid = `bulk-${index}`;
      const ref = `aaaaaaaaaaaaaaaaaaaa${String(index).padStart(6, "0")}`;
      state.memberships[`${uid}__${TEAM_A}`] = membership(uid, TEAM_A, ref);
    }
    const result = await listEligibleColleagues(OWNER, depsFor(state, {}));
    if (!result.ok) throw new Error("expected a listing");
    expect(result.truncated).toBe(true);
    // The team holds more members than one read returns, so the listing shows no more than one team read's worth of members.
    expect(result.colleagues.length).toBeLessThanOrEqual(MAX_MEMBERS_PER_TEAM);
  });
});

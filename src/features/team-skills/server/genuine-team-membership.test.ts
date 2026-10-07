import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";

const isAppAdminSpy = vi.fn();
vi.mock("../../teams/domain/app-admin", () => ({
  isAppAdmin: (...args: unknown[]) => isAppAdminSpy(...args),
}));

import {
  requireGenuineLead,
  requireGenuineMember,
  resolveGenuineTeamMembership,
  type GenuineMembershipReads,
} from "./genuine-team-membership";

const TEAM = "team-1";
const OTHER_TEAM = "team-2";
const ADMIN_EMAIL = "admin@example.com";

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "user-1", email: "dev@example.com", emailVerified: true, ...overrides };
}
const adminIdentity = () => identity({ email: ADMIN_EMAIL });

function membership(uid: string, teamId: string, extra: Record<string, unknown> = {}) {
  return { uid, teamId, ...extra };
}

interface State {
  teams: Record<string, unknown>;
  memberships: Record<string, unknown>;
  failTeam?: boolean;
  failMembership?: boolean;
}

function reads(state: State) {
  const calls = { team: [] as string[], membership: [] as string[] };
  const r: GenuineMembershipReads & { calls: typeof calls } = {
    calls,
    async getTeamStatus(teamId) {
      calls.team.push(teamId);
      if (state.failTeam) throw new Error("boom");
      return state.teams[teamId];
    },
    async getMembership(uid, teamId) {
      calls.membership.push(`${uid}__${teamId}`);
      if (state.failMembership) throw new Error("boom");
      return state.memberships[`${uid}__${teamId}`];
    },
  };
  return r;
}

beforeEach(() => {
  isAppAdminSpy.mockReset();
  // Even if consulted, this would make everyone an admin — it must not matter.
  isAppAdminSpy.mockReturnValue(true);
});

describe("resolveGenuineTeamMembership", () => {
  it("reports an ordinary member as member", async () => {
    const r = reads({
      teams: { [TEAM]: "active" },
      memberships: { [`user-1__${TEAM}`]: membership("user-1", TEAM) },
    });
    expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: r })).toEqual({
      ok: true,
      relationship: "member",
      teamStatus: "active",
    });
  });

  it("reports a stored lead as lead", async () => {
    const r = reads({
      teams: { [TEAM]: "active" },
      memberships: { [`user-1__${TEAM}`]: membership("user-1", TEAM, { role: "lead" }) },
    });
    expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: r })).toEqual({
      ok: true,
      relationship: "lead",
      teamStatus: "active",
    });
  });

  it("keeps lead for a lead who is also on the app-admin allow-list", async () => {
    const r = reads({
      teams: { [TEAM]: "active" },
      memberships: { [`user-1__${TEAM}`]: membership("user-1", TEAM, { role: "lead" }) },
    });
    const result = await resolveGenuineTeamMembership(adminIdentity(), TEAM, { reads: r });
    expect(result).toMatchObject({ ok: true, relationship: "lead" });
  });

  it("keeps member for a member who is also an app admin", async () => {
    const r = reads({
      teams: { [TEAM]: "active" },
      memberships: { [`user-1__${TEAM}`]: membership("user-1", TEAM) },
    });
    const result = await resolveGenuineTeamMembership(adminIdentity(), TEAM, { reads: r });
    expect(result).toMatchObject({ ok: true, relationship: "member" });
  });

  it("denies an app admin without a membership", async () => {
    const r = reads({ teams: { [TEAM]: "active" }, memberships: {} });
    const result = await resolveGenuineTeamMembership(adminIdentity(), TEAM, { reads: r });
    expect(result).toMatchObject({ ok: true, relationship: "denied" });
  });

  it("denies an unrelated ordinary user and a removed member", async () => {
    const r = reads({ teams: { [TEAM]: "active" }, memberships: {} });
    expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: r })).toMatchObject({
      relationship: "denied",
    });
  });

  it("never consults app-admin status", async () => {
    const r = reads({
      teams: { [TEAM]: "active" },
      memberships: { [`user-1__${TEAM}`]: membership("user-1", TEAM, { role: "lead" }) },
    });
    await resolveGenuineTeamMembership(adminIdentity(), TEAM, { reads: r });
    await resolveGenuineTeamMembership(identity(), "nope", { reads: r });
    expect(isAppAdminSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", "LEAD", "Lead", "manager", 1, true, {}, ["lead"]])(
    "does not elevate malformed role %j to lead",
    async (role) => {
      const r = reads({
        teams: { [TEAM]: "active" },
        memberships: { [`user-1__${TEAM}`]: membership("user-1", TEAM, { role }) },
      });
      expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: r })).toMatchObject({
        relationship: "member",
      });
    },
  );

  it("denies a membership document that belongs to another uid or team", async () => {
    const r = reads({
      teams: { [TEAM]: "active" },
      memberships: {
        [`user-1__${TEAM}`]: membership("someone-else", TEAM, { role: "lead" }),
      },
    });
    expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: r })).toMatchObject({
      relationship: "denied",
    });
    const r2 = reads({
      teams: { [TEAM]: "active" },
      memberships: { [`user-1__${TEAM}`]: membership("user-1", OTHER_TEAM, { role: "lead" }) },
    });
    expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: r2 })).toMatchObject({
      relationship: "denied",
    });
  });

  it("does not let a membership in team A prove membership in team B", async () => {
    const r = reads({
      teams: { [TEAM]: "active", [OTHER_TEAM]: "active" },
      memberships: { [`user-1__${TEAM}`]: membership("user-1", TEAM, { role: "lead" }) },
    });
    expect(await resolveGenuineTeamMembership(identity(), OTHER_TEAM, { reads: r })).toMatchObject({
      relationship: "denied",
    });
    expect(r.calls.membership).toEqual([`user-1__${OTHER_TEAM}`]);
  });

  it("does not let another uid's membership authorize the caller", async () => {
    const r = reads({
      teams: { [TEAM]: "active" },
      memberships: { [`user-2__${TEAM}`]: membership("user-2", TEAM, { role: "lead" }) },
    });
    expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: r })).toMatchObject({
      relationship: "denied",
    });
    expect(r.calls.membership).toEqual([`user-1__${TEAM}`]);
  });

  it("reports disabled-team member and lead with teamStatus disabled (not denied)", async () => {
    const r = reads({
      teams: { [TEAM]: "disabled" },
      memberships: {
        [`user-1__${TEAM}`]: membership("user-1", TEAM, { role: "lead" }),
        [`user-2__${TEAM}`]: membership("user-2", TEAM),
      },
    });
    expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: r })).toEqual({
      ok: true,
      relationship: "lead",
      teamStatus: "disabled",
    });
    expect(
      await resolveGenuineTeamMembership(identity({ uid: "user-2" }), TEAM, { reads: r }),
    ).toEqual({ ok: true, relationship: "member", teamStatus: "disabled" });
  });

  it("denies everyone for a missing team or an invalid team status", async () => {
    const r = reads({
      teams: { bad: "archived", worse: 5 },
      memberships: {
        [`user-1__${TEAM}`]: membership("user-1", TEAM, { role: "lead" }),
        user_bad: null,
        [`user-1__bad`]: membership("user-1", "bad", { role: "lead" }),
      },
    });
    for (const id of [TEAM, "bad", "worse"]) {
      expect(await resolveGenuineTeamMembership(identity(), id, { reads: r })).toEqual({
        ok: true,
        relationship: "denied",
        teamStatus: "disabled",
      });
    }
  });

  it("returns read_failed (never denied) when either read fails", async () => {
    const teamFail = reads({ teams: {}, memberships: {}, failTeam: true });
    expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: teamFail })).toEqual({
      ok: false,
      error: "read_failed",
    });
    const memFail = reads({
      teams: { [TEAM]: "active" },
      memberships: {},
      failMembership: true,
    });
    expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: memFail })).toEqual({
      ok: false,
      error: "read_failed",
    });
  });

  it("returns only relationship and teamStatus (no uid, email, memberRef or raw document)", async () => {
    const r = reads({
      teams: { [TEAM]: "active" },
      memberships: {
        [`user-1__${TEAM}`]: membership("user-1", TEAM, { role: "lead", memberRef: "m1" }),
      },
    });
    const result = await resolveGenuineTeamMembership(identity(), TEAM, { reads: r });
    expect(Object.keys(result).sort()).toEqual(["ok", "relationship", "teamStatus"]);
  });

  it("does not treat memberRef or email as membership proof", async () => {
    const r = reads({
      teams: { [TEAM]: "active" },
      memberships: {
        "other__team-1": { uid: "other", teamId: TEAM, role: "lead", memberRef: "user-1", email: "dev@example.com" },
      },
    });
    expect(await resolveGenuineTeamMembership(identity(), TEAM, { reads: r })).toMatchObject({
      relationship: "denied",
    });
  });
});

describe("requireGenuineMember / requireGenuineLead", () => {
  const lead = () =>
    reads({
      teams: { [TEAM]: "active" },
      memberships: { [`user-1__${TEAM}`]: membership("user-1", TEAM, { role: "lead" }) },
    });
  const member = (status = "active") =>
    reads({
      teams: { [TEAM]: status },
      memberships: { [`user-1__${TEAM}`]: membership("user-1", TEAM) },
    });

  it("lets a member through for member requirement and a lead for both", async () => {
    expect(await requireGenuineMember(identity(), TEAM, { reads: member() })).toEqual({ ok: true, relationship: "member" });
    expect(await requireGenuineMember(identity(), TEAM, { reads: lead() })).toEqual({ ok: true, relationship: "lead" });
    expect(await requireGenuineLead(identity(), TEAM, { reads: lead() })).toEqual({ ok: true });
  });

  it("forbids an ordinary member from lead requirement", async () => {
    expect(await requireGenuineLead(identity(), TEAM, { reads: member() })).toEqual({ ok: false, error: "forbidden" });
  });

  it("forbids non-members and non-member admins, with no team_disabled leak", async () => {
    const none = reads({ teams: { [TEAM]: "disabled" }, memberships: {} });
    for (const who of [identity(), adminIdentity()]) {
      expect(await requireGenuineMember(who, TEAM, { reads: none })).toEqual({ ok: false, error: "forbidden" });
      expect(await requireGenuineLead(who, TEAM, { reads: none })).toEqual({ ok: false, error: "forbidden" });
    }
  });

  it("orders role before status: member on disabled team is forbidden for lead, lead gets team_disabled", async () => {
    expect(await requireGenuineLead(identity(), TEAM, { reads: member("disabled") })).toEqual({ ok: false, error: "forbidden" });
    const disabledLead = reads({
      teams: { [TEAM]: "disabled" },
      memberships: { [`user-1__${TEAM}`]: membership("user-1", TEAM, { role: "lead" }) },
    });
    expect(await requireGenuineLead(identity(), TEAM, { reads: disabledLead })).toEqual({ ok: false, error: "team_disabled" });
    expect(await requireGenuineMember(identity(), TEAM, { reads: member("disabled") })).toEqual({ ok: false, error: "team_disabled" });
  });

  it("propagates read_failed", async () => {
    const failing = reads({ teams: {}, memberships: {}, failMembership: true, failTeam: true });
    expect(await requireGenuineMember(identity(), TEAM, { reads: failing })).toEqual({ ok: false, error: "read_failed" });
    expect(await requireGenuineLead(identity(), TEAM, { reads: failing })).toEqual({ ok: false, error: "read_failed" });
  });
});

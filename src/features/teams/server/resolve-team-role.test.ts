import { describe, expect, it } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import type { AuthorizeTeamAccessCollection } from "./authorize-team-access";
import { authorizeTeamAccess } from "./authorize-team-access";
import { resolveTeamRole } from "./resolve-team-role";

const ADMIN_EMAIL = "admin@example.com";

function identity(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return { uid: "user-1", email: "dev@example.com", emailVerified: true, ...overrides };
}

const adminIdentity = () => identity({ uid: "admin-1", email: ADMIN_EMAIL });

const plainMembership = { uid: "user-1", teamId: "team-1", createdAt: new Date(), createdVia: "invitation", grantedBy: "a" };
const leadMembership = { ...plainMembership, role: "lead" };

interface FakeState {
  teams?: Record<string, unknown>;
  memberships?: Record<string, unknown>;
  failStatus?: boolean;
  failMembership?: boolean;
}

function fakeCollection(state: FakeState) {
  const calls = { status: 0, membership: 0 };
  const collection: AuthorizeTeamAccessCollection = {
    async getTeamStatus(teamId) {
      calls.status += 1;
      if (state.failStatus) throw new Error("secret internal detail");
      return state.teams?.[teamId];
    },
    async getMembership(uid, teamId) {
      calls.membership += 1;
      if (state.failMembership) throw new Error("secret internal detail");
      return state.memberships?.[`${uid}__${teamId}`];
    },
  };
  return { collection, calls };
}

const deps = (collection: AuthorizeTeamAccessCollection) => ({ allowList: [ADMIN_EMAIL], collection });

async function roleOf(id: VerifiedIdentity, state: FakeState) {
  return resolveTeamRole(id, "team-1", deps(fakeCollection(state).collection));
}

describe("resolveTeamRole", () => {
  describe("admin", () => {
    it("resolves an app admin on an active team to admin", async () => {
      expect(await roleOf(adminIdentity(), { teams: { "team-1": "active" } })).toEqual({ ok: true, role: "admin" });
    });

    it("resolves an app admin on a disabled team to admin (existing admin semantics)", async () => {
      expect(await roleOf(adminIdentity(), { teams: { "team-1": "disabled" } })).toEqual({ ok: true, role: "admin" });
    });

    it("resolves an app admin who also holds a lead membership to admin, never lead", async () => {
      const result = await roleOf(adminIdentity(), {
        teams: { "team-1": "active" },
        memberships: { "admin-1__team-1": { ...leadMembership, uid: "admin-1" } },
      });

      expect(result).toEqual({ ok: true, role: "admin" });
    });

    it("resolves an app admin who is an ordinary member to admin", async () => {
      const result = await roleOf(adminIdentity(), {
        teams: { "team-1": "active" },
        memberships: { "admin-1__team-1": { ...plainMembership, uid: "admin-1" } },
      });

      expect(result).toEqual({ ok: true, role: "admin" });
    });

    it("does not treat an allow-listed but unverified e-mail as admin", async () => {
      const result = await roleOf(identity({ uid: "admin-1", email: ADMIN_EMAIL, emailVerified: false }), {
        teams: { "team-1": "active" },
      });

      expect(result).toEqual({ ok: true, role: "denied" });
    });
  });

  describe("lead and member on an active team", () => {
    const active = { "team-1": "active" };

    it("resolves a member with role: lead to lead", async () => {
      const result = await roleOf(identity(), { teams: active, memberships: { "user-1__team-1": leadMembership } });

      expect(result).toEqual({ ok: true, role: "lead" });
    });

    it("resolves a membership without a role field (every pre-existing document) to member", async () => {
      const result = await roleOf(identity(), { teams: active, memberships: { "user-1__team-1": plainMembership } });

      expect(result).toEqual({ ok: true, role: "member" });
    });

    it.each([
      ["an explicit \"member\"", "member"],
      ["an unknown string", "superuser"],
      ["a differently-cased string", "Lead"],
      ["a number", 1],
      ["null", null],
      ["an object", { lead: true }],
    ])("resolves a malformed/unknown role (%s) to member, never lead or admin", async (_label, role) => {
      const result = await roleOf(identity(), {
        teams: active,
        memberships: { "user-1__team-1": { ...plainMembership, role } },
      });

      expect(result).toEqual({ ok: true, role: "member" });
    });

    it("ignores roleUpdated* fields when classifying", async () => {
      const result = await roleOf(identity(), {
        teams: active,
        memberships: { "user-1__team-1": { ...plainMembership, roleUpdatedAt: new Date(), roleUpdatedBy: "admin-1" } },
      });

      expect(result).toEqual({ ok: true, role: "member" });
    });

    it("supports several leads in one team independently", async () => {
      const memberships = {
        "user-1__team-1": leadMembership,
        "user-2__team-1": { ...leadMembership, uid: "user-2" },
        "user-3__team-1": { ...plainMembership, uid: "user-3" },
      };

      expect(await roleOf(identity({ uid: "user-1" }), { teams: active, memberships })).toEqual({ ok: true, role: "lead" });
      expect(await roleOf(identity({ uid: "user-2" }), { teams: active, memberships })).toEqual({ ok: true, role: "lead" });
      expect(await roleOf(identity({ uid: "user-3" }), { teams: active, memberships })).toEqual({ ok: true, role: "member" });
    });
  });

  describe("denied", () => {
    const active = { "team-1": "active" };

    it("resolves a non-member to denied", async () => {
      expect(await roleOf(identity(), { teams: active })).toEqual({ ok: true, role: "denied" });
    });

    it("resolves a membership document belonging to a different uid to denied, even if it claims lead", async () => {
      const result = await roleOf(identity(), {
        teams: active,
        memberships: { "user-1__team-1": { ...leadMembership, uid: "someone-else" } },
      });

      expect(result).toEqual({ ok: true, role: "denied" });
    });

    it("resolves a membership document belonging to a different team to denied, even if it claims lead", async () => {
      const result = await roleOf(identity(), {
        teams: active,
        memberships: { "user-1__team-1": { ...leadMembership, teamId: "team-2" } },
      });

      expect(result).toEqual({ ok: true, role: "denied" });
    });

    it("resolves a lead of another team to denied for this team", async () => {
      const result = await roleOf(identity(), {
        teams: { "team-1": "active", "team-2": "active" },
        memberships: { "user-1__team-2": { ...leadMembership, teamId: "team-2" } },
      });

      expect(result).toEqual({ ok: true, role: "denied" });
    });

    it("resolves a removed lead (membership deleted) to denied", async () => {
      const state: FakeState = { teams: active, memberships: { "user-1__team-1": leadMembership } };
      expect(await roleOf(identity(), state)).toEqual({ ok: true, role: "lead" });

      delete state.memberships?.["user-1__team-1"];

      expect(await roleOf(identity(), state)).toEqual({ ok: true, role: "denied" });
    });

    it.each([
      ["missing", undefined],
      ["malformed (unknown string)", "archived"],
      ["malformed (wrong type)", 7],
      ["malformed (wrong case)", "Active"],
    ])("fails closed to denied for everyone, admin included, when the team status is %s", async (_label, status) => {
      const teams = { "team-1": status };
      const memberships = { "user-1__team-1": leadMembership };

      expect(await roleOf(identity(), { teams, memberships })).toEqual({ ok: true, role: "denied" });
      expect(await roleOf(adminIdentity(), { teams, memberships })).toEqual({ ok: true, role: "denied" });
    });
  });

  describe("disabled team", () => {
    const disabled = { "team-1": "disabled" };

    it("keeps an ordinary member a member (existing access semantics)", async () => {
      const result = await roleOf(identity(), { teams: disabled, memberships: { "user-1__team-1": plainMembership } });

      expect(result).toEqual({ ok: true, role: "member" });
    });

    it("resolves a stored lead to member, not lead — the role is dormant, not removed", async () => {
      const state: FakeState = { teams: disabled, memberships: { "user-1__team-1": leadMembership } };

      expect(await roleOf(identity(), state)).toEqual({ ok: true, role: "member" });
      expect(state.memberships?.["user-1__team-1"]).toEqual(leadMembership);
    });

    it("makes the stored lead effective again once the team is re-activated", async () => {
      const state: FakeState = { teams: { ...disabled }, memberships: { "user-1__team-1": leadMembership } };
      expect(await roleOf(identity(), state)).toEqual({ ok: true, role: "member" });

      state.teams = { "team-1": "active" };

      expect(await roleOf(identity(), state)).toEqual({ ok: true, role: "lead" });
    });

    it("still denies a non-member", async () => {
      expect(await roleOf(identity(), { teams: disabled })).toEqual({ ok: true, role: "denied" });
    });
  });

  describe("read failures", () => {
    it("reports read_failed (never denied or member) when the team-status read fails", async () => {
      const result = await roleOf(identity(), { failStatus: true, memberships: { "user-1__team-1": leadMembership } });

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });

    it("reports read_failed when the membership read fails", async () => {
      const result = await roleOf(identity(), { teams: { "team-1": "active" }, failMembership: true });

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });

    it("reports read_failed, without echoing the underlying error, if the membership read fails on the lead re-check", async () => {
      const state: FakeState = { teams: { "team-1": "active" }, memberships: { "user-1__team-1": leadMembership } };
      let membershipReads = 0;
      const { collection } = fakeCollection(state);
      const flaky: AuthorizeTeamAccessCollection = {
        getTeamStatus: collection.getTeamStatus,
        async getMembership(uid, teamId) {
          membershipReads += 1;
          if (membershipReads > 1) throw new Error("secret internal detail");
          return collection.getMembership(uid, teamId);
        },
      };

      const result = await resolveTeamRole(identity(), "team-1", deps(flaky));

      expect(result).toEqual({ ok: false, error: "read_failed" });
      expect(JSON.stringify(result)).not.toContain("secret");
    });

    it("reports read_failed when the team-status re-check fails for a stored lead", async () => {
      const { collection } = fakeCollection({ teams: { "team-1": "active" }, memberships: { "user-1__team-1": leadMembership } });
      let statusReads = 0;
      const flaky: AuthorizeTeamAccessCollection = {
        getMembership: collection.getMembership,
        async getTeamStatus(teamId) {
          statusReads += 1;
          if (statusReads > 1) throw new Error("secret internal detail");
          return collection.getTeamStatus(teamId);
        },
      };

      const result = await resolveTeamRole(identity(), "team-1", deps(flaky));

      expect(result).toEqual({ ok: false, error: "read_failed" });
    });
  });

  describe("composition with authorizeTeamAccess", () => {
    it("passes admin, denied and read_failed through from authorizeTeamAccess verbatim", async () => {
      const cases: Array<[VerifiedIdentity, FakeState]> = [
        [adminIdentity(), { teams: { "team-1": "active" } }],
        [identity(), { teams: { "team-1": "active" } }],
        [identity(), { failStatus: true }],
      ];

      for (const [id, state] of cases) {
        const authorized = await authorizeTeamAccess(id, "team-1", deps(fakeCollection(state).collection));
        const resolved = await roleOf(id, state);

        expect(resolved).toEqual(
          authorized.ok ? { ok: true, role: authorized.access } : { ok: false, error: authorized.error },
        );
      }
    });

    it("leaves authorizeTeamAccess classifying a lead as a plain member (intentional compatibility rule)", async () => {
      const state: FakeState = { teams: { "team-1": "active" }, memberships: { "user-1__team-1": leadMembership } };

      const authorized = await authorizeTeamAccess(identity(), "team-1", deps(fakeCollection(state).collection));
      const resolved = await roleOf(identity(), state);

      expect(authorized).toEqual({ ok: true, access: "member" });
      expect(resolved).toEqual({ ok: true, role: "lead" });
    });

    it("never reads more than authorizeTeamAccess does for an admin or a non-member (no extra reads on those paths)", async () => {
      const { collection, calls } = fakeCollection({ teams: { "team-1": "active" } });
      await resolveTeamRole(identity(), "team-1", deps(collection));
      const baseline = { ...calls };
      const again = fakeCollection({ teams: { "team-1": "active" } });
      await authorizeTeamAccess(identity(), "team-1", deps(again.collection));

      expect(baseline).toEqual(again.calls);
    });

    it("returns only the role — no uid, e-mail, membership document or audit fields", async () => {
      const result = await roleOf(identity(), {
        teams: { "team-1": "active" },
        memberships: { "user-1__team-1": { ...leadMembership, roleUpdatedBy: "admin-1", roleUpdatedAt: new Date() } },
      });

      expect(result).toEqual({ ok: true, role: "lead" });
      expect(Object.keys(result).sort()).toEqual(["ok", "role"]);
    });
  });
});

import { describe, expect, it } from "vitest";
import { canAdministerTeam, canAdministerTeamScope, effectiveTeamVisibility, isTeamVisibility } from "./team-authority";
import { membershipRoleOf } from "./team-membership";

const TEAM = "team-1";
const membership = (role?: unknown) => ({ uid: "u1", teamId: TEAM, createdVia: "invitation", ...(role === undefined ? {} : { role }) });

describe("team visibility defaults", () => {
  it("treats a missing, unknown or non-string visibility as private (fail closed)", () => {
    expect(effectiveTeamVisibility(undefined)).toBe("private");
    expect(effectiveTeamVisibility("PUBLIC")).toBe("private");
    expect(effectiveTeamVisibility(true)).toBe("private");
    expect(effectiveTeamVisibility("public")).toBe("public");
  });

  it("accepts exactly the two visibility values", () => {
    expect(isTeamVisibility("private")).toBe(true);
    expect(isTeamVisibility("public")).toBe(true);
    expect(isTeamVisibility("shared")).toBe(false);
    expect(isTeamVisibility(undefined)).toBe(false);
  });
});

describe("membership role classification", () => {
  it("classifies only exact teamadmin as teamadmin", () => {
    expect(membershipRoleOf(membership("teamadmin"))).toBe("teamadmin");
    expect(membershipRoleOf(membership())).toBe("member");
  });

  it("grants nothing for a legacy stored lead role", () => {
    expect(membershipRoleOf(membership("lead"))).toBe("member");
    expect(canAdministerTeam({ isSuperadmin: false, uid: "u1", teamId: TEAM, membership: membership("lead") })).toBe(false);
  });
});

describe("canAdministerTeam", () => {
  it("lets a superadmin administer any team, with or without membership", () => {
    expect(canAdministerTeam({ isSuperadmin: true, uid: "u1", teamId: TEAM, membership: undefined })).toBe(true);
  });

  it("lets a genuine teamadmin administer their own team only", () => {
    const own = membership("teamadmin");
    expect(canAdministerTeam({ isSuperadmin: false, uid: "u1", teamId: TEAM, membership: own })).toBe(true);
    expect(canAdministerTeam({ isSuperadmin: false, uid: "u1", teamId: "team-2", membership: own })).toBe(false);
  });

  it("refuses an ordinary member, a membership for another uid, and a malformed document", () => {
    expect(canAdministerTeam({ isSuperadmin: false, uid: "u1", teamId: TEAM, membership: membership() })).toBe(false);
    expect(canAdministerTeam({ isSuperadmin: false, uid: "u2", teamId: TEAM, membership: membership("teamadmin") })).toBe(false);
    expect(canAdministerTeam({ isSuperadmin: false, uid: "u1", teamId: TEAM, membership: "teamadmin" })).toBe(false);
  });
});

describe("canAdministerTeamScope", () => {
  it("is true only for an admin-capable role on an active team", () => {
    expect(canAdministerTeamScope({ role: "teamadmin", teamStatus: "active" })).toBe(true);
    expect(canAdministerTeamScope({ role: "admin", teamStatus: "active" })).toBe(true);
    expect(canAdministerTeamScope({ role: "teamadmin", teamStatus: "disabled" })).toBe(false);
    expect(canAdministerTeamScope({ role: "admin", teamStatus: null })).toBe(false);
    expect(canAdministerTeamScope({ role: "member", teamStatus: "active" })).toBe(false);
    expect(canAdministerTeamScope({ role: "denied", teamStatus: "active" })).toBe(false);
  });
});

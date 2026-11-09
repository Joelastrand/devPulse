import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { decideCollaborativeLevelWrite, type DecideCollaborativeLevelWriteInput } from "./decide-collaborative-level-write";
import type { GenuineMembershipDeps } from "./genuine-team-membership";

vi.mock("../../../lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const TEAM = "team-1";
const TREE = "tree-alpha";
const identity = (uid: string): VerifiedIdentity => ({ uid, email: `${uid}@example.com`, emailVerified: true });

/** Synthetic callers: a teamadmin, a plain member, a superadmin without membership, and a non-member. */
type Role = "teamadmin" | "member" | "none";
function deps(role: Role, status: unknown = "active", superUid?: string): GenuineMembershipDeps {
  return {
    isSuperadmin: vi.fn(async (uid: string) => uid === superUid),
    reads: {
      async getTeamStatus() {
        return status;
      },
      async getMembership(uid: string, teamId: string) {
        return role === "none" ? undefined : { uid, teamId, role };
      },
    },
  };
}

const request = (uid: string, value: unknown): DecideCollaborativeLevelWriteInput => ({
  identity: identity(uid),
  teamId: TEAM,
  treeId: TREE,
  value,
});

describe("decideCollaborativeLevelWrite: authorization", () => {
  it("accepts a genuine teamadmin of an active team", async () => {
    expect(await decideCollaborativeLevelWrite(request("u-lead", 3), deps("teamadmin"))).toEqual({
      ok: true,
      teamId: TEAM,
      treeId: TREE,
      level: 3,
    });
  });

  it("accepts a superadmin who is not a team member", async () => {
    expect(await decideCollaborativeLevelWrite(request("u-super", 2), deps("none", "active", "u-super"))).toEqual({
      ok: true,
      teamId: TEAM,
      treeId: TREE,
      level: 2,
    });
  });

  it("refuses an ordinary member as forbidden", async () => {
    expect(await decideCollaborativeLevelWrite(request("u-member", 3), deps("member"))).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("refuses a non-member as forbidden", async () => {
    expect(await decideCollaborativeLevelWrite(request("u-other", 3), deps("none"))).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("refuses a teamadmin of a disabled team as team_disabled", async () => {
    expect(await decideCollaborativeLevelWrite(request("u-lead", 3), deps("teamadmin", "disabled"))).toEqual({
      ok: false,
      error: "team_disabled",
    });
  });

  it("reports forbidden, not invalid_input, for a non-admin with a malformed payload", async () => {
    expect(await decideCollaborativeLevelWrite(request("u-member", 9), deps("member"))).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("reports read_failed when the team status read throws", async () => {
    const failing: GenuineMembershipDeps = {
      isSuperadmin: async () => false,
      reads: {
        async getTeamStatus() {
          throw new Error("boom");
        },
        async getMembership() {
          return { uid: "u-lead", teamId: TEAM, role: "teamadmin" };
        },
      },
    };
    expect(await decideCollaborativeLevelWrite(request("u-lead", 3), failing)).toEqual({
      ok: false,
      error: "read_failed",
    });
  });
});

describe("decideCollaborativeLevelWrite: input", () => {
  it("accepts null as an explicit clear", async () => {
    expect(await decideCollaborativeLevelWrite(request("u-lead", null), deps("teamadmin"))).toEqual({
      ok: true,
      teamId: TEAM,
      treeId: TREE,
      level: null,
    });
  });

  it.each([1, 2, 3, 4])("accepts the level %s", async (level) => {
    expect(await decideCollaborativeLevelWrite(request("u-lead", level), deps("teamadmin"))).toMatchObject({
      ok: true,
      level,
    });
  });

  it.each([0, 5, -1, 2.5, "3", NaN, Infinity, undefined, true, {}])("rejects %j as invalid_input", async (value) => {
    expect(await decideCollaborativeLevelWrite(request("u-lead", value), deps("teamadmin"))).toEqual({
      ok: false,
      error: "invalid_input",
    });
  });
});

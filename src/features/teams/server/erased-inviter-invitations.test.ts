import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "../../auth/server/verify-identity";
import { fetchTeamInvitations } from "../client/admin-team-detail-gateway";
import { isValidPendingInvitationFor, isValidPendingInvitationForTeam } from "../domain/team-invitation";
import type { TeamInvitationsCollection } from "./list-team-invitations";
import { listTeamInvitations } from "./list-team-invitations";

// TASK-017 (account-erasure, approved option (a)): a preserved invitation whose inviter was erased has `invitedBy: null`.
// That state stays valid and visible where it was visible before; any other malformed inviter value is still rejected.
// Fixtures are synthetic.

const ADMIN_EMAIL = "admin@example.com";
const CREATED_AT = new Date("2026-09-01T00:00:00Z");
const TEAM = "team-1";

function verifiedAdmin(): VerifiedIdentity {
  return { uid: "admin-1", email: ADMIN_EMAIL, emailVerified: true };
}

function verifyAs(identity: VerifiedIdentity) {
  return vi.fn().mockResolvedValue({ uid: identity.uid, email: identity.email, email_verified: true });
}

function collectionOf(rawDocs: unknown[]): TeamInvitationsCollection {
  return { listRawForTeam: vi.fn().mockResolvedValue(rawDocs) };
}

const pending = (overrides: Record<string, unknown> = {}) => ({
  teamId: TEAM,
  email: "dev@example.com",
  status: "pending",
  invitedBy: "admin-1",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  ...overrides,
});

describe("pending invitation with a normal inviter (unchanged)", () => {
  it("is valid for the team and for its expected email", () => {
    expect(isValidPendingInvitationForTeam(pending(), TEAM)).toBe(true);
    expect(isValidPendingInvitationFor(pending(), { teamId: TEAM, email: "dev@example.com" })).toBe(true);
  });
});

describe("preserved invitation with invitedBy: null (erased inviter)", () => {
  it("is valid for the team and for its expected email, so it stays readable and resolvable", () => {
    const erased = pending({ invitedBy: null });
    expect(isValidPendingInvitationForTeam(erased, TEAM)).toBe(true);
    expect(isValidPendingInvitationFor(erased, { teamId: TEAM, email: "dev@example.com" })).toBe(true);
  });

  it("stays visible in the admin list, with the inviter absent and no identity of any kind", async () => {
    const result = await listTeamInvitations("token", TEAM, {
      verifyToken: verifyAs(verifiedAdmin()),
      allowList: [ADMIN_EMAIL],
      collection: collectionOf([pending({ invitedBy: null, email: "kept@example.com" })]),
    });

    expect(result).toEqual({
      ok: true,
      invitations: [{ email: "kept@example.com", invitedBy: null, createdAt: CREATED_AT }],
    });
    if (!result.ok) throw new Error("expected ok result");
    const row: Record<string, unknown> = { ...result.invitations[0] };
    expect(Object.keys(row).sort()).toEqual(["createdAt", "email", "invitedBy"]);
    expect(JSON.stringify(row)).not.toMatch(/uid|erased|deleted/i);
  });

  it("does not grant visibility to a non-admin: the erased-inviter state changes nothing about authorization", async () => {
    const member = { uid: "member-1", email: "member@example.com", emailVerified: true };
    const nullInviter = await listTeamInvitations("token", TEAM, {
      verifyToken: verifyAs(member),
      allowList: [ADMIN_EMAIL],
      collection: collectionOf([pending({ invitedBy: null })]),
    });
    // Contrast: the same non-admin with a normal string inviter is refused in exactly the same way.
    const stringInviter = await listTeamInvitations("token", TEAM, {
      verifyToken: verifyAs(member),
      allowList: [ADMIN_EMAIL],
      collection: collectionOf([pending({ invitedBy: "admin-1" })]),
    });

    expect(nullInviter.ok).toBe(false);
    expect(stringInviter).toEqual(nullInviter);
  });
});

describe("malformed inviter values remain rejected (not made acceptable by the null rule)", () => {
  it.each([
    ["a missing inviter", undefined],
    ["an empty string", ""],
    ["a number", 42],
    ["an object", { uid: "admin-1" }],
    ["a boolean", false],
  ])("rejects %s for both the team list and the resolve/pending predicate", (_label, invitedBy) => {
    const record = pending({ invitedBy });
    expect(isValidPendingInvitationForTeam(record, TEAM)).toBe(false);
    expect(isValidPendingInvitationFor(record, { teamId: TEAM, email: "dev@example.com" })).toBe(false);
  });

  it("drops a malformed-inviter row from the admin list while keeping a valid neighbour", async () => {
    const result = await listTeamInvitations("token", TEAM, {
      verifyToken: verifyAs(verifiedAdmin()),
      allowList: [ADMIN_EMAIL],
      collection: collectionOf([
        pending({ email: "bad@example.com", invitedBy: 42 }),
        pending({ email: "good@example.com", invitedBy: null }),
      ]),
    });

    expect(result).toEqual({
      ok: true,
      invitations: [{ email: "good@example.com", invitedBy: null, createdAt: CREATED_AT }],
    });
  });
});

describe("admin gateway accepts the explicit null and nothing malformed (TASK-017)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubInvitations(invitations: unknown[]) {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ invitations }) })));
  }

  it("accepts an invitation with invitedBy null", async () => {
    stubInvitations([{ email: "a@example.com", invitedBy: null, createdAt: "2026-01-01T00:00:00.000Z" }]);

    expect(await fetchTeamInvitations("t", TEAM)).toEqual({
      status: "ok",
      invitations: [{ email: "a@example.com", invitedBy: null, createdAt: "2026-01-01T00:00:00.000Z" }],
    });
  });

  it("rejects the whole list when any row carries a malformed inviter (fail closed)", async () => {
    stubInvitations([
      { email: "a@example.com", invitedBy: null, createdAt: "2026-01-01T00:00:00.000Z" },
      { email: "b@example.com", invitedBy: 42, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    expect(await fetchTeamInvitations("t", TEAM)).toEqual({ status: "read_failed" });
  });
});
